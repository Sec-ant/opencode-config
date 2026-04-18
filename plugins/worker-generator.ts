// =============================================================================
// worker-generator — Generate/update worker subagents from available models
//
// Registers the /update-workers command which:
//   1. Queries OpenCode for the github-copilot provider's resolved model list
//      (filtered to models the current auth actually has access to)
//   2. Fetches the Copilot API to cross-reference available models and get
//      capability flags (thinking, reasoning, vision, etc.)
//   3. Generates agents/worker-*.md and commands/worker-*.md files
//   4. Removes stale worker files for models no longer available
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
// Model classification & parameter derivation
// ---------------------------------------------------------------------------

interface ModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  temperature: boolean;
}

interface AgentParams {
  steps: number;
  temperature?: number;
  variant?: string;
}

function deriveAgentParams(model: ModelInfo): AgentParams {
  const { id } = model;
  const isLightweight = /-(mini|flash|haiku)(-|$)/i.test(id);

  if (!model.reasoning) {
    return {
      steps: isLightweight ? 100 : 200,
      temperature: model.temperature ? 0.2 : undefined,
    };
  }

  // All reasoning models use variant — opencode's variant system translates
  // to the correct provider options (reasoningEffort, reasoningSummary, etc.)
  const isHighEnd =
    /5\.[23]-codex/.test(id) || /gpt-5\.[2-9]/.test(id);
  const variant = id.startsWith("claude")
    ? "high"   // Claude via Copilot: max is high (low/medium/high)
    : isHighEnd
      ? "xhigh" // GPT codex 5.2/5.3, GPT-5.2+: supports xhigh
      : "high";  // Other GPT reasoning models

  return {
    steps: isLightweight ? 100 : 200,
    temperature: model.temperature ? 0.2 : undefined,
    variant,
  };
}

// ---------------------------------------------------------------------------
// File content generators
// ---------------------------------------------------------------------------

function generateAgent(model: ModelInfo): string {
  const p = deriveAgentParams(model);

  const lines: string[] = [
    "---",
    `description: Worker subagent (${model.name})`,
    "mode: subagent",
    `model: ${PROVIDER_ID}/${model.id}`,
  ];

  if (p.temperature !== undefined) lines.push(`temperature: ${p.temperature}`);
  lines.push(`steps: ${p.steps}`);
  if (p.variant !== undefined) lines.push(`variant: ${p.variant}`);

  lines.push(
    "permission:",
    "  task:",
    '    "*": deny',
    `    "worker-${model.id}": allow`,
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

function generateCommand(model: ModelInfo): string {
  return (
    [
      "---",
      `description: Route to ${model.name}`,
      "agent: shelby",
      "---",
      `/worker-${model.id} $ARGUMENTS`,
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

      // ── Phase 2: Fetch Copilot API for model cross-referencing ──
      let copilotModels: Map<string, CopilotModel> | null = null;
      const token = await getCopilotToken();
      if (token) {
        try {
          copilotModels = await fetchCopilotModels(token);
        } catch (err: any) {
          await client.app
            .log({
              body: {
                service: "worker-generator",
                level: "warn",
                message: `Copilot API fetch failed: ${err?.message}. Will skip model cross-referencing.`,
              },
            })
            .catch(() => {});
        }
      } else {
        await client.app
          .log({
            body: {
              service: "worker-generator",
              level: "warn",
              message:
                "No Copilot auth token found. Will skip model cross-referencing.",
            },
          })
          .catch(() => {});
      }

      // ── Phase 3: Build merged model list ──
      // Use the intersection of providers() and Copilot API when available.
      // Models in providers() but absent from the Copilot API are likely
      // decommissioned — generating workers for them would be pointless.
      const models = new Map<string, ModelInfo>();
      for (const [id, raw] of Object.entries(provider.models) as [
        string,
        any,
      ][]) {
        if (SKIP_MODELS.has(id)) continue;
        if (copilotModels && !copilotModels.has(id)) continue;
        models.set(id, {
          id,
          name: raw.name || id,
          reasoning: raw.capabilities?.reasoning ?? raw.reasoning ?? false,
          temperature: raw.capabilities?.temperature ?? raw.temperature ?? true,
        });
      }

      if (models.size === 0)
        throw new Error("No models found for github-copilot provider");

      await mkdir(AGENTS_DIR, { recursive: true });
      await mkdir(COMMANDS_DIR, { recursive: true });

      const generatedIds = new Set<string>();
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let removed = 0;

      // ── Phase 4: Generate agents & commands ──
      for (const [id, model] of models) {
        generatedIds.add(id);

        // Agent & command files (same logic as before)
        for (const [file, content] of [
          [join(AGENTS_DIR, `worker-${id}.md`), generateAgent(model)],
          [join(COMMANDS_DIR, `worker-${id}.md`), generateCommand(model)],
        ] as const) {
          try {
            const existing = await readFile(file, "utf-8").catch(() => null);
            if (existing === content) {
              unchanged++;
              continue;
            }
            existing === null ? created++ : updated++;
            await writeFile(file, content, "utf-8");
          } catch (err: any) {
            await client.app
              .log({
                body: {
                  service: "worker-generator",
                  level: "error",
                  message: `Failed to write worker-${id}: ${err?.message}`,
                },
              })
              .catch(() => {});
          }
        }
      }

      // ── Phase 5: Clean stale worker files ──
      for (const dir of [AGENTS_DIR, COMMANDS_DIR]) {
        for (const id of await listExistingWorkers(dir)) {
          if (!generatedIds.has(id)) {
            removed++;
            await unlink(join(dir, `worker-${id}.md`)).catch(() => {});
          }
        }
      }

      // ── Report ──
      const parts = [
        `${models.size} models`,
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
