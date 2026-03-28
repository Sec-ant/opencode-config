import { type Plugin, tool } from "@opencode-ai/plugin";

const plugin: Plugin = async ({ client, $ }) => ({
  tool: {
    get_session_id: tool({
      description: "Returns current session ID.",
      args: {},
      async execute(_, { sessionID }) {
        return sessionID;
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
    if (command !== "sid") {
      return;
    }
    try {
      // using pbcopy for macOS
      // for cross-platform support consider using a library like clipboardy
      await $`printf '%s' ${sessionID} | pbcopy`.quiet();
      await client.tui.showToast({
        body: {
          message: sessionID,
          variant: "success",
        },
      });
    } catch {
      await client.tui.showToast({
        body: {
          message: "Failed to copy current session ID to clipboard",
          variant: "error",
        },
      });
    }
    throw new Error("ok");
  },
});

export default plugin;
