import { type Plugin, tool } from "@opencode-ai/plugin";

function formatTranscript(
  messages: Array<{ info: any; parts: any[] }>,
  limit: number,
): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.info.role === "user") {
      lines.push("## User");
      for (const part of msg.parts) {
        if (part.type === "text" && !part.ignored) lines.push(part.text);
        if (part.type === "file") lines.push(`[Attached: ${part.filename || "file"}]`);
      }
      lines.push("");
    }
    if (msg.info.role === "assistant") {
      lines.push("## Assistant");
      for (const part of msg.parts) {
        if (part.type === "text") lines.push(part.text);
        if (part.type === "tool" && part.state?.status === "completed")
          lines.push(`[Tool: ${part.tool}] ${part.state.title}`);
      }
      lines.push("");
    }
  }
  const output = lines.join("\n").trim();
  if (messages.length >= limit)
    return output + `\n\n(Showing ${messages.length} most recent messages. Use a higher 'limit' to see more.)`;
  return output + `\n\n(End of session - ${messages.length} messages)`;
}

const plugin: Plugin = async ({ client, $ }) => ({
  tool: {
    get_session_id: tool({
      description: "Returns current session ID.",
      args: {},
      async execute(_, { sessionID }) {
        return sessionID;
      },
    }),
    read_session: tool({
      description:
        "Read the conversation transcript from a previous session. Use this when you need specific information from the source session that wasn't included in the handoff summary.",
      args: {
        sessionID: tool.schema
          .string()
          .describe("The full session ID (e.g., sess_01jxyz...)"),
        limit: tool.schema
          .number()
          .optional()
          .describe("Maximum number of messages to read (defaults to 100, max 500)"),
      },
      async execute(args) {
        const limit = Math.min(args.limit ?? 100, 500);
        try {
          const response = await client.session.messages({
            path: { id: args.sessionID },
            query: { limit },
          });
          if (!response.data || response.data.length === 0)
            return "Session has no messages or does not exist.";
          return formatTranscript(response.data, limit);
        } catch (error) {
          return `Could not read session ${args.sessionID}: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  },
  config: async (config) => {
    config.command = config.command ?? {};
    config.command.sid = {
      description: "Copy current session ID to clipboard",
      template: ".",
    };
  },
  "command.execute.before": async ({ command, sessionID }) => {
    if (command !== "sid") return;

    // Try clipboard commands in order: macOS, WSL/Windows, Linux X11, Wayland
    const clips = [
      () => $`printf '%s' ${sessionID} | pbcopy`.quiet(),
      () => $`printf '%s' ${sessionID} | clip.exe`.quiet(),
      () => $`printf '%s' ${sessionID} | xclip -selection clipboard`.quiet(),
      () => $`printf '%s' ${sessionID} | xsel --clipboard`.quiet(),
      () => $`printf '%s' ${sessionID} | wl-copy`.quiet(),
    ];

    let copied = false;
    for (const clip of clips) {
      try {
        await clip();
        copied = true;
        break;
      } catch {}
    }

    await client.tui.showToast({
      body: {
        title: copied ? "Copied" : "Session ID",
        message: sessionID,
        variant: copied ? "success" : "info",
        duration: copied ? 3000 : 8000,
      },
    });
    throw new Error("ok");
  },
});

export default plugin;
