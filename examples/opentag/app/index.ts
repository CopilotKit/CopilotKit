/**
 * The OpenTag bot application — user-land code, not SDK code. The companion
 * `runtime.ts` holds the AG-UI agent backend (a CopilotKit `BuiltInAgent`);
 * this directory holds everything that runs on the chat-platform side.
 *
 * MULTI-PLATFORM: this single app drives Slack, Discord, and/or Telegram from
 * one process. `@copilotkit/bot`'s `createBot` accepts an array of adapters and
 * starts them all, so we include each platform's adapter only when its secrets
 * are present. Drop in `SLACK_*` for Slack, `DISCORD_*` for Discord,
 * `TELEGRAM_BOT_TOKEN` for Telegram — or any combination. Everything else in
 * `app/` (tools, the tag card, the confirm_tag HITL gate, the /tag command) is
 * platform-agnostic and shared verbatim. This is the directory you copy to
 * start your own bot.
 */
import "dotenv/config";
import { createBot } from "@copilotkit/bot";
import type { PlatformAdapter, BotTool, ContextEntry } from "@copilotkit/bot";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/bot-slack";
import {
  discord,
  defaultDiscordTools,
  defaultDiscordContext,
} from "@copilotkit/bot-discord";
import {
  telegram,
  defaultTelegramTools,
  defaultTelegramContext,
} from "@copilotkit/bot-telegram";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { senderContext } from "./sender-context.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
};

/** True only when every named env var is set and non-empty. */
const have = (...names: string[]): boolean =>
  names.every((n) => Boolean(process.env[n]));

async function main() {
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  // Build the platform list from whichever secrets are present. Each adapter
  // contributes its own built-in tools (e.g. `lookup_*_user`) and context
  // (tagging + formatting guidance), added only when that platform is active so
  // the model isn't handed a different platform's conventions.
  const adapters: PlatformAdapter[] = [];
  const tools: BotTool[] = [...appTools];
  const context: ContextEntry[] = [...appContext];

  if (have("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN")) {
    adapters.push(
      slack({
        botToken: required("SLACK_BOT_TOKEN"),
        appToken: required("SLACK_APP_TOKEN"),
        // Keep DMs conversational and respond to explicit @mentions in
        // channels/threads. Plain channel replies stay quiet unless they
        // mention OpenTag again.
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
      }),
    );
    tools.push(...defaultSlackTools);
    context.push(...defaultSlackContext);
  }

  if (have("DISCORD_BOT_TOKEN", "DISCORD_APP_ID")) {
    adapters.push(
      discord({
        botToken: required("DISCORD_BOT_TOKEN"),
        appId: required("DISCORD_APP_ID"),
        // Optional: register slash commands to one guild instantly during dev
        // (global commands can take up to ~1h to propagate). Omit in prod.
        guildId: process.env.DISCORD_GUILD_ID,
      }),
    );
    tools.push(...defaultDiscordTools);
    context.push(...defaultDiscordContext);
  }

  if (have("TELEGRAM_BOT_TOKEN")) {
    // Telegram long-polls by default (no public URL / webhook needed).
    adapters.push(telegram({ token: required("TELEGRAM_BOT_TOKEN") }));
    tools.push(...defaultTelegramTools);
    context.push(...defaultTelegramContext);
  }

  if (adapters.length === 0) {
    console.error(
      "No platform secrets found. Set SLACK_BOT_TOKEN + SLACK_APP_TOKEN, " +
        "DISCORD_BOT_TOKEN + DISCORD_APP_ID, and/or TELEGRAM_BOT_TOKEN (see README).",
    );
    process.exit(1);
  }

  const bot = createBot({
    adapters,
    // One AG-UI agent per conversation, pointed at the runtime. The backend is a
    // CopilotKit `BuiltInAgent` (CopilotSseRuntime), which does NOT require a
    // UUID-format threadId, so the raw conversation thread id is fine.
    // `SanitizingHttpAgent` is a lenient superset of `HttpAgent`; one factory
    // covers Slack, Discord, and Telegram alike.
    agent: (threadId) => {
      const a = new SanitizingHttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    // `appTools` adds OpenTag's tools (read_thread, confirm_tag, tag_card); the
    // per-platform `default*Tools` add `lookup_*_user`. `default*Context` ships
    // tagging/formatting guidance; `appContext` adds OpenTag's identity + policy.
    tools,
    context,
    // The `/tag` slash command. On Slack it must ALSO be declared in the app
    // config (paste `slack-app-manifest.yaml`); Discord and Telegram register
    // commands up front. The engine routes by name; adapters that can't take
    // commands ignore them.
    commands: appCommands,
  });

  // One handler covers explicit @-mentions and DMs across every active platform.
  // `senderContext` names the requesting user per `thread.platform`. Wrap the
  // run so a failed turn is logged and surfaced instead of crashing the process.
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

  // Slack-only nicety: set the assistant-pane prompt chips when a pane opens.
  // Harmless elsewhere — `onThreadStarted` only fires from adapters that emit it
  // (Discord/Telegram have no assistant pane), and platforms without
  // suggested-prompt support no-op.
  bot.onThreadStarted(async ({ thread }) => {
    await thread.setSuggestedPrompts([
      { title: "Tag this thread", message: "Tag this thread" },
    ]);
  });

  await bot.start();
  console.log(
    `[opentag] started on: ${adapters.map((a) => a.platform).join(", ")}`,
  );

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
