/**
 * The OpenTag bot application — user-land code, not SDK code. The companion
 * `runtime.ts` holds the AG-UI agent backend (a CopilotKit `BuiltInAgent`);
 * this directory holds everything that runs on the chat-platform side.
 *
 * This is the directory you copy to start your own bot. It runs on Slack via
 * `@copilotkit/bot-slack` over Socket Mode (no public URL needed). Everything in
 * `app/` (the tools, the tag card, the confirm_tag HITL gate, the /tag command)
 * is platform-agnostic, so moving to another surface is just swapping the
 * adapter: `@copilotkit/bot` ships `-discord`, `-telegram`, `-whatsapp`, and
 * `-teams` adapters with the same shape. See the README ("Run it elsewhere").
 */
import "dotenv/config";
import { createBot } from "@copilotkit/bot";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/bot-slack";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { senderContext } from "./sender-context.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing required env var: ${name} (see README / .env.example)`,
    );
    process.exit(1);
  }
  return v;
};

async function main() {
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  // The Slack adapter. It contributes its own built-in tools (`lookup_slack_user`)
  // and context (Slack tagging + formatting guidance), which we add alongside
  // OpenTag's own tools/context below.
  const slackAdapter = slack({
    botToken: required("SLACK_BOT_TOKEN"),
    appToken: required("SLACK_APP_TOKEN"),
    // Keep DMs conversational and respond to explicit @mentions in
    // channels/threads. Plain channel replies stay quiet unless they mention
    // OpenTag again.
    respondTo: {
      directMessages: true,
      appMentions: { reply: "thread" },
      threadReplies: "mentionsOnly",
    },
    // Assistant pane greeting + chips (shown when a user opens the pane).
    assistant: {
      greeting: "Hi! Mention me in a thread and I'll suggest a tag.",
      suggestedPrompts: [
        { title: "Tag this thread", message: "Tag this thread" },
      ],
    },
  });

  const bot = createBot({
    adapters: [slackAdapter],
    // One AG-UI agent per conversation, pointed at the runtime. The backend is a
    // CopilotKit `BuiltInAgent` (CopilotSseRuntime), which does NOT require a
    // UUID-format threadId, so the raw conversation thread id is fine.
    // `SanitizingHttpAgent` is a lenient superset of `HttpAgent`.
    agent: (threadId) => {
      const a = new SanitizingHttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    // `appTools` adds OpenTag's tools (read_thread, confirm_tag, tag_card);
    // `defaultSlackTools` adds `lookup_slack_user`. `defaultSlackContext` ships
    // Slack tagging/formatting guidance; `appContext` adds OpenTag's identity +
    // policy.
    tools: [...appTools, ...defaultSlackTools],
    context: [...appContext, ...defaultSlackContext],
    // The `/tag` slash command. On Slack it must ALSO be declared in the app
    // config (paste `slack-app-manifest.yaml`); the engine routes by name.
    commands: appCommands,
  });

  // One handler covers explicit @-mentions and DMs. `senderContext` names the
  // requesting user. Wrap the run so a failed turn is logged and surfaced
  // instead of crashing the process.
  bot.onMention(async ({ thread, message }) => {
    try {
      await thread.runAgent({
        context: senderContext(message.user, thread.platform),
      });
    } catch (err) {
      console.error("[opentag] agent run failed", err);
      await thread
        .post("Sorry — I hit an error handling that. Please try again.")
        .catch(() => {});
    }
  });

  // Set the assistant-pane prompt chips when a Slack pane opens.
  bot.onThreadStarted(async ({ thread }) => {
    await thread.setSuggestedPrompts([
      { title: "Tag this thread", message: "Tag this thread" },
    ]);
  });

  await bot.start();
  console.log("[opentag] started on: slack");

  const shutdown = async (signal: string) => {
    console.log(`\n[opentag] received ${signal}, stopping…`);
    await bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Fail loud, not silent: surface stray async errors instead of letting them
// kill the process with no log. Log and keep running — one bad turn shouldn't
// take the bot down.
process.on("unhandledRejection", (reason) => {
  console.error("[opentag] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[opentag] uncaughtException:", err);
});

main().catch((err) => {
  console.error("[opentag] fatal", err);
  process.exit(1);
});
