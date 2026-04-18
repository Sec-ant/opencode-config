// =============================================================================
// angstrom-levy — Subagent session continuity + relay context optimization
//
// Five responsibilities, all stateless (driven by conversation history):
//
//   1. Worker-aware continuity — when shelby calls a worker subagent without
//      an explicit task_id, inspect the latest user message. If it starts with
//      /worker-<name>, force routing to that worker and resume that worker's
//      most recent session when available. Otherwise, route to the worker used
//      by the most recent worker task in this shelby session and inject its
//      task_id.
//
//   2. Prompt passthrough — override the task tool's `prompt` parameter
//      with the user's verbatim message (stripping any /worker-* prefix).
//      This enforces relay.md's "original message verbatim" rule via code
//      rather than relying on shelby's LLM compliance.
//
//   3. Doom loop prevention — strip the "task_id: ... (for resuming ...)"
//      line from task tool output. This text triggers gpt-5-mini to
//      re-call the task tool instead of relaying the result. The task_id
//      is already in metadata.sessionId.
//
//   4. Context stripping — strip media file parts and large synthetic text
//      parts from shelby's LLM context via the messages transform hook.
//      Requires the core code change (toolMessages snapshot in prompt.ts)
//      so that ctx.messages retains the original unmodified parts for the
//      task tool's attachment lookup.
//
//   5. Attachment forwarding — auto-inject media attachment part IDs from
//      the latest user message into the task tool's attachments parameter,
//      so worker subagents receive media files even though shelby's LLM
//      never sees them.
// =============================================================================

import type { Plugin } from "@opencode-ai/plugin";

const WORKER_PREFIX = "worker-";
const WORKER_TYPE_REGEX = new RegExp(`^${WORKER_PREFIX}`);
const WORKER_CMD_REGEX = new RegExp(
  `^\\s*/(${WORKER_PREFIX}\\S+)(?:\\s+|$)`,
);

// Synthetic text parts longer than this threshold are truncated in shelby's
// context. File-read headers ("Called the Read tool ...") are typically ~100
// chars; actual file content is thousands to tens of thousands.
const SYNTHETIC_TEXT_THRESHOLD = 300;

function assumeAs<T>(value: unknown): asserts value is T {
  /* void */
}

function isMediaMime(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf";
}

interface TaskParameters {
  description: string;
  prompt: string;
  subagent_type?: string;
  task_id?: string;
  command?: string;
  attachments?: string[];
}

interface WorkerTaskSession {
  subagentType: string;
  sessionId: string;
}

const angstromLevy: Plugin = async ({ client }) => {
  return {
    // ── 4. Context stripping ──────────────────────────────────────────────
    //
    // For shelby sessions, strip heavy content from the messages array that
    // gets sent to toModelMessages (and thus to the LLM). With the core
    // prompt.ts change, ctx.messages (toolMessages) is a separate snapshot
    // taken before this hook runs, so the task tool still has access to the
    // original unmodified parts for attachment forwarding.
    //
    "experimental.chat.messages.transform": async (_input, output) => {
      // Detect shelby session from the most recent user message
      const lastUser = [...output.messages]
        .reverse()
        .find((m) => m.info.role === "user");
      if (
        !lastUser ||
        lastUser.info.role !== "user" ||
        lastUser.info.agent !== "shelby"
      )
        return;

      for (const msg of output.messages) {
        if (msg.info.role !== "user") continue;

        const stripped: typeof msg.parts = [];
        for (const part of msg.parts) {
          // Strip media file parts (images, PDFs). The worker will receive
          // them via auto-injected attachment IDs (responsibility 5).
          if (part.type === "file" && isMediaMime(part.mime)) {
            // Replace with a lightweight text placeholder so shelby knows a
            // file was attached but doesn't pay the context cost of the binary.
            stripped.push({
              id: part.id,
              sessionID: part.sessionID,
              messageID: part.messageID,
              type: "text",
              text: `[Media attachment: ${part.filename ?? "file"} (${part.mime}) — forwarded to worker automatically]`,
              synthetic: true,
            });
            continue;
          }

          // Truncate large synthetic text parts (e.g. full file content from
          // Read tool). Short synthetics like "Called the Read tool with ..."
          // are kept intact so shelby has minimal awareness.
          if (
            part.type === "text" &&
            part.synthetic &&
            part.text.length > SYNTHETIC_TEXT_THRESHOLD
          ) {
            const lineCount = part.text.split("\n").length;
            stripped.push({
              ...part,
              text: `[File content: ~${lineCount} lines — forwarded to worker automatically]`,
            });
            continue;
          }

          stripped.push(part);
        }
        msg.parts = stripped;
      }
    },

    // ── 1–3, 5. Task tool interception ────────────────────────────────────
    //
    "tool.execute.before": async ({ tool, sessionID }, output) => {
      if (tool !== "task") return;

      assumeAs<TaskParameters>(output.args);

      const { task_id: taskId, subagent_type: subagentType } = output.args;

      // Only intervene if task_id is not already provided
      if (taskId) return;

      const { data } = await client.session.messages({
        path: { id: sessionID },
      });
      if (!data) return;

      // Guard: only intervene for shelby sessions.
      // Also capture the user's verbatim text and media part IDs for prompt
      // passthrough (2), worker selection (1), and attachment forwarding (5).
      let isShelby = false;
      let userPrompt: string | undefined;
      const mediaPartIds: string[] = [];
      for (let i = data.length - 1; i >= 0; i--) {
        const { info, parts } = data[i];
        if (info.role === "user") {
          isShelby = info.agent === "shelby";
          if (isShelby) {
            const textParts: string[] = [];
            for (const p of parts) {
              if (p.type === "text") textParts.push(p.text);
              if (p.type === "file" && isMediaMime(p.mime)) {
                mediaPartIds.push(p.id);
              }
            }
            userPrompt = textParts.join("");
          }
          break;
        }
      }
      if (!isShelby) return;

      // ── 1. Context continuity ───────────────────────────────────────────
      // Scan history for the last completed/errored worker task session.
      // task_id always resumes the most recent session (cross-worker continuity).
      // subagent_type inherits from that session when no explicit prefix given.
      let lastWorkerSession: WorkerTaskSession | undefined;
      for (const { parts } of data) {
        for (const part of parts) {
          if (part.type !== "tool" || part.tool !== "task") continue;
          const { state } = part;
          if (state?.status !== "completed" && state?.status !== "error")
            continue;

          const workerType = state.input?.subagent_type as
            | string
            | undefined;
          const workerSessionId = state.metadata?.sessionId as
            | string
            | undefined;

          if (workerType?.match(WORKER_TYPE_REGEX) && workerSessionId) {
            lastWorkerSession = {
              subagentType: workerType,
              sessionId: workerSessionId,
            };
          }
        }
      }

      const explicitWorker = userPrompt?.match(WORKER_CMD_REGEX)?.[1];
      const routedWorker =
        explicitWorker ?? lastWorkerSession?.subagentType ?? subagentType;

      // Only intervene for worker-* subagents
      if (!routedWorker?.match(WORKER_TYPE_REGEX)) return;

      output.args.subagent_type = routedWorker;

      // Always resume the most recent worker session, regardless of worker
      // type. This preserves context continuity even when switching workers.
      if (lastWorkerSession) {
        output.args.task_id = lastWorkerSession.sessionId;
      }

      // ── 2. Prompt passthrough ───────────────────────────────────────────
      // Override with the user's verbatim text (from DB, which has the full
      // file content even though the transform hook stripped it from the
      // LLM-facing messages).
      if (userPrompt !== undefined) {
        const stripped = userPrompt.replace(WORKER_CMD_REGEX, "").trim();
        if (stripped) {
          output.args.prompt = stripped;
        }
      }

      // ── 5. Attachment forwarding ────────────────────────────────────────
      // Auto-inject media part IDs so the task tool forwards them to the
      // worker. Since the transform hook stripped media from the LLM-facing
      // messages, shelby's LLM won't include attachment IDs itself.
      if (mediaPartIds.length > 0) {
        output.args.attachments = mediaPartIds;
      }
    },

    // ── 3. Doom loop prevention ───────────────────────────────────────────
    "tool.execute.after": async ({ tool }, output) => {
      if (tool !== "task") return;
      output.output = output.output.replace(/^task_id: [^\n]+\n\n/, "");
    },
  };
};

export default angstromLevy;
