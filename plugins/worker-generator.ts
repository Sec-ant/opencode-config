// =============================================================================
// worker-generator — Generate/update worker subagents from available models
//
// Registers the /update-workers command which:
//   1. Queries OpenCode for the github-copilot provider's resolved model list
//      (filtered to models the current auth actually has access to)
//   2. Fetches the Copilot API to cross-reference available models and get
//      capability flags (thinking, reasoning, vision, variants, etc.)
//   3. For reasoning models, generates per-variant worker files:
//        agents/worker-{id}-{variant}.md, commands/worker-{id}-{variant}.md
//      Non-reasoning models get a single worker as before.
//   4. Removes stale worker files for models/variants no longer available
//
// Variant discovery:
//   The Copilot API exposes `reasoning_effort: string[]` per model (e.g.
//   ["low","medium","high"] or ["low","medium","high","xhigh"]).  The API
//   is required — the command fails if the token is missing or the call errors.
//
// Model limits are handled by OpenCode's built-in Copilot plugin (same API).
//
// Environment variables:
//   OPENCODE_SKIP_WORKER_MODELS  Comma-separated model IDs to exclude
//   OPENCODE_COPILOT_API_URL     Override Copilot API base URL (enterprise)
// =============================================================================

import { type Plugin } from "@opencode-ai/plugin";
import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const AGENTS_DIR = join(CONFIG_DIR, "agents");
const COMMANDS_DIR = join(CONFIG_DIR, "commands");
const PROVIDER_ID = "github-copilot";

const COPILOT_API_BASE =
  process.env.OPENCODE_COPILOT_API_URL ||
  "https://api.individual.githubcopilot.com";

const SKIP_MODELS = new Set<string>(
  (process.env.OPENCODE_SKIP_WORKER_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// Copilot API: auth & model fetching
// ---------------------------------------------------------------------------

interface CopilotSupports {
  adaptive_thinking?: boolean;
  max_thinking_budget?: number;
  min_thinking_budget?: number;
  reasoning_effort?: string[];
  parallel_tool_calls?: boolean;
  vision?: boolean;
}

interface CopilotModel {
  id: string;
  name: string;
  vendor: string;
  supports: CopilotSupports;
  state: string;
  preview: boolean;
}

/**
 * Read the OpenCode OAuth token from auth.json.
 * This is a long-lived gho_ token that works directly against the Copilot API
 * (no JWT exchange needed, unlike the VS Code ghu_ token flow).
 */
async function getCopilotToken(): Promise<string | null> {
  const dataDir = process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
  const authFile = join(dataDir, "opencode", "auth.json");
  try {
    const data = JSON.parse(await readFile(authFile, "utf-8"));
    const copilot = data[PROVIDER_ID];
    return copilot?.refresh || copilot?.access || null;
  } catch {
    return null;
  }
}

/**
 * Fetch the model list from the Copilot API.
 * Used to cross-reference against OpenCode's provider list — models absent
 * from this API are likely decommissioned and should not get workers.
 */
async function fetchCopilotModels(
  token: string,
): Promise<Map<string, CopilotModel>> {
  const resp = await fetch(`${COPILOT_API_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Openai-Intent": "conversation-edits",
    },
  });
  if (!resp.ok) {
    throw new Error(
      `Copilot API returned ${resp.status}: ${await resp.text()}`,
    );
  }
  const body = (await resp.json()) as { data: any[] };
  const result = new Map<string, CopilotModel>();
  for (const m of body.data) {
    const caps = m.capabilities ?? {};
    const supports = caps.supports ?? {};
    result.set(m.id, {
      id: m.id,
      name: m.name ?? m.id,
      vendor: m.vendor ?? "unknown",
      supports: {
        adaptive_thinking: supports.adaptive_thinking,
        max_thinking_budget: supports.max_thinking_budget,
        min_thinking_budget: supports.min_thinking_budget,
        reasoning_effort: supports.reasoning_effort,
        parallel_tool_calls: supports.parallel_tool_calls,
        vision: supports.vision,
      },
      state: m.policy?.state ?? "unknown",
      preview: m.preview ?? false,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Model info
// ---------------------------------------------------------------------------

interface ModelInfo {
  id: string;
  name: string;
  /** Reasoning effort variants from the Copilot API. Empty for non-reasoning models. */
  variants: string[];
}

// ---------------------------------------------------------------------------
// File content generators
// ---------------------------------------------------------------------------

function generateAgent(model: ModelInfo, variant?: string): string {
  const variantLabel = variant ? ` [${variant}]` : "";
  const lines: string[] = [
    "---",
    `description: Worker subagent (${model.name}${variantLabel})`,
    "mode: subagent",
    `model: ${PROVIDER_ID}/${model.id}`,
    "steps: 200",
  ];

  if (variant !== undefined) lines.push(`variant: ${variant}`);

  // Workers of the same model can spawn each other (base + all variants).
  lines.push(
    "permission:",
    "  task:",
    '    "*": deny',
    `    "worker-${model.id}*": allow`,
    "    explore: allow",
    "  question: allow",
    "  read: allow",
    "  edit: allow",
    "  bash:",
    '    "*": allow',
    "  glob: allow",
    "  grep: allow",
    "  list: allow",
    "  webfetch: allow",
    "  websearch: allow",
    "  codesearch: allow",
    "---",
  );

  return lines.join("\n") + "\n";
}

function generateCommand(displayName: string, targetWorker: string): string {
  return (
    [
      "---",
      `description: Route to ${displayName}`,
      "agent: shelby",
      "---",
      `/${targetWorker} $ARGUMENTS`,
    ].join("\n") + "\n"
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listExistingWorkers(dir: string): Promise<Set<string>> {
  const files = await readdir(dir).catch(() => []);
  const set = new Set<string>();
  for (const f of files) {
    const m = f.match(/^worker-(.+)\.md$/);
    if (m) set.add(m[1]);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = async ({ client }) => ({
  config: async (config) => {
    config.command = config.command ?? {};
    config.command["update-workers"] = {
      description: "Update worker subagents from available Copilot models",
      template: ".",
    };
  },

  "command.execute.before": async ({ command }) => {
    if (command !== "update-workers") return;

    try {
      // ── Phase 1: Get model list from OpenCode ──
      // providers() returns models resolved by OpenCode (respecting auth,
      // whitelist/blacklist, etc.) — used as the authoritative model roster.
      const { data } = await client.config.providers();
      if (!data) throw new Error("Failed to fetch providers from OpenCode");

      const provider = (data as any).providers?.find(
        (p: any) => p.id === PROVIDER_ID,
      );
      if (!provider)
        throw new Error(`Provider "${PROVIDER_ID}" not found or not connected`);

      // ── Phase 2: Fetch Copilot API (required for variant discovery) ──
      const token = await getCopilotToken();
      if (!token)
        throw new Error(
          "No Copilot auth token found. Cannot fetch model variants.",
        );

      let copilotModels: Map<string, CopilotModel>;
      try {
        copilotModels = await fetchCopilotModels(token);
      } catch (err: any) {
        throw new Error(`Copilot API fetch failed: ${err?.message}`);
      }

      // ── Phase 3: Build merged model list ──
      // Intersect providers() with Copilot API — models absent from the API
      // are likely decommissioned.  Variants come from the API's
      // reasoning_effort[] field (e.g. ["low","medium","high"]).
      const models = new Map<string, ModelInfo>();
      for (const [id, raw] of Object.entries(provider.models) as [
        string,
        any,
      ][]) {
        if (SKIP_MODELS.has(id)) continue;
        if (!copilotModels.has(id)) continue;

        const copilotInfo = copilotModels.get(id)!;
        const variants = copilotInfo.supports?.reasoning_effort ?? [];

        models.set(id, {
          id,
          name: raw.name || id,
          variants,
        });
      }

      if (models.size === 0)
        throw new Error("No models found for github-copilot provider");

      await mkdir(AGENTS_DIR, { recursive: true });
      await mkdir(COMMANDS_DIR, { recursive: true });

      // Track generated worker names (the part after "worker-") separately
      // for agents and commands — reasoning models only produce variant-
      // suffixed entries (e.g. "claude-opus-4.6-high"), no base entry.
      const generatedAgents = new Set<string>();
      const generatedCommands = new Set<string>();
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let removed = 0;

      /** Write a worker file, tracking create/update/unchanged counts. */
      async function writeWorker(dir: string, name: string, content: string) {
        const file = join(dir, `worker-${name}.md`);
        try {
          const existing = await readFile(file, "utf-8").catch(() => null);
          if (existing === content) {
            unchanged++;
            return;
          }
          existing === null ? created++ : updated++;
          await writeFile(file, content, "utf-8");
        } catch (err: any) {
          await client.app
            .log({
              body: {
                service: "worker-generator",
                level: "error",
                message: `Failed to write worker-${name}: ${err?.message}`,
              },
            })
            .catch(() => {});
        }
      }

      // ── Phase 4: Generate agents & commands ──
      for (const [id, model] of models) {
        // Every model gets a base worker without variant.
        generatedAgents.add(id);
        generatedCommands.add(id);
        await writeWorker(AGENTS_DIR, id, generateAgent(model));
        await writeWorker(
          COMMANDS_DIR,
          id,
          generateCommand(model.name, `worker-${id}`),
        );

        // Reasoning models also get one worker per API variant.
        for (const variant of model.variants) {
          const name = `${id}-${variant}`;
          generatedAgents.add(name);
          generatedCommands.add(name);

          await writeWorker(AGENTS_DIR, name, generateAgent(model, variant));
          await writeWorker(
            COMMANDS_DIR,
            name,
            generateCommand(
              `${model.name} [${variant}]`,
              `worker-${id}-${variant}`,
            ),
          );
        }
      }

      // ── Phase 5: Clean stale worker files ──
      for (const name of await listExistingWorkers(AGENTS_DIR)) {
        if (!generatedAgents.has(name)) {
          removed++;
          await unlink(join(AGENTS_DIR, `worker-${name}.md`)).catch(() => {});
        }
      }
      for (const name of await listExistingWorkers(COMMANDS_DIR)) {
        if (!generatedCommands.has(name)) {
          removed++;
          await unlink(join(COMMANDS_DIR, `worker-${name}.md`)).catch(() => {});
        }
      }

      // ── Report ──
      const workerCount = generatedAgents.size;
      const parts = [
        `${models.size} models → ${workerCount} workers`,
        created > 0 ? `${created} created` : null,
        updated > 0 ? `${updated} updated` : null,
        removed > 0 ? `${removed} removed` : null,
        unchanged > 0 ? `${unchanged} unchanged` : null,
      ].filter(Boolean);

      await client.tui.showToast({
        body: {
          message: `Workers updated: ${parts.join(", ")}`,
          variant: "success",
        },
      });
    } catch (err: any) {
      if (err?.message === "ok") throw err;
      await client.tui.showToast({
        body: {
          message: `Worker update failed: ${err?.message || err}`,
          variant: "error",
        },
      });
    }

    throw new Error("ok");
  },
});

export default plugin;
