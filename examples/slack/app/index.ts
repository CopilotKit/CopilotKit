/**
 * The bot _application_ — user-land code, not SDK code. The companion
 * `runtime.ts` holds the AG-UI agent backend (a CopilotKit `BuiltInAgent`
 * wired to the Linear + Notion MCP servers); this directory holds everything
 * that runs on the chat-platform side of the bot for this deployment.
 *
 * MULTI-PLATFORM: this single app drives Slack, Discord, Telegram, and/or
 * WhatsApp from one process. `@copilotkit/bot`'s `createBot` accepts an array
 * of adapters and starts them all, so we include each platform's adapter only
 * when its secrets are present. Drop in `SLACK_*` to run Slack, `DISCORD_*` for
 * Discord, `TELEGRAM_BOT_TOKEN` for Telegram, `WHATSAPP_*` for WhatsApp — or any
 * combination to run them at once. The rest of `app/` (tools, components, HITL,
 * rendering) is platform-agnostic and shared verbatim.
 *
 * Defaults are not auto-applied — you spread them explicitly. That's
 * deliberate: there's no hidden behavior, and the canonical pattern is right
 * here in the file you copy from to start a new bot.
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
import {
  whatsapp,
  defaultWhatsAppTools,
  defaultWhatsAppContext,
} from "@copilotkit/bot-whatsapp";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { senderContext } from "./sender-context.js";
import { fileIssueSubmit, FILE_ISSUE_CALLBACK } from "./modals/file-issue.js";
import { closeBrowser } from "./render/browser.js";

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
  // contributes its own built-in tools (e.g. `lookup_slack_user` /
  // `lookup_discord_user` / `lookup_telegram_user`) and context (tagging +
  // formatting guidance), added only when that platform is active so the model
  // isn't handed a different platform's conventions.
  const adapters: PlatformAdapter[] = [];
  const tools: BotTool[] = [...appTools];
  const context: ContextEntry[] = [...appContext];

  if (have("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN")) {
    adapters.push(
      slack({
        botToken: required("SLACK_BOT_TOKEN"),
        appToken: required("SLACK_APP_TOKEN"),
        // Don't surface tool-call progress in the UI (no task_update timeline,
        // `:wrench:` rows, or pane "is using `tool`…" status). Tools still run;
        // only the display is hidden.
        showToolStatus: false,
        // Kite keeps DMs conversational and responds to explicit app mentions
        // in channels/threads. Plain channel thread replies stay quiet unless
        // they mention Kite again.
        respondTo: {
          directMessages: true,
          appMentions: { reply: "thread" },
          threadReplies: "mentionsOnly",
        },
        // Assistant-pane behavior is ON by default; this just customizes it.
        // The greeting + chips show when a user opens the pane (matching the
        // app manifest's `assistant_view`); native streaming + status need no
        // config. Pass `assistant: false` / `streaming: "legacy"` to opt out.
        assistant: {
          greeting: "Hi! I can triage issues, search docs, and more.",
          suggestedPrompts: [
            {
              title: "Triage my open issues",
              message: "Triage my open issues",
            },
            {
              title: "What shipped this week?",
              message: "Summarize what shipped this week",
            },
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
    // Telegram long-polls by default (no public URL / webhook setup needed).
    // No greeting/suggestedPrompts: Telegram has no assistant-pane surface.
    adapters.push(telegram({ token: required("TELEGRAM_BOT_TOKEN") }));
    tools.push(...defaultTelegramTools);
    context.push(...defaultTelegramContext);
  }

  if (
    have(
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
    )
  ) {
    // Unlike Slack/Discord (outbound), WhatsApp adds an INBOUND webhook HTTP
    // server. It listens on Railway's injected `$PORT` (the public domain
    // routes there); locally it defaults to 3000. Fail loud on a malformed
    // PORT rather than letting `Number("abc")` → NaN reach `server.listen()`.
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    if (!Number.isInteger(port) || port < 0) {
      console.error(
        `Invalid PORT: "${process.env.PORT}" is not a valid port number`,
      );
      process.exit(1);
    }
    adapters.push(
      whatsapp({
        accessToken: required("WHATSAPP_ACCESS_TOKEN"),
        phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
        appSecret: required("WHATSAPP_APP_SECRET"),
        verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
        port,
        path: process.env.WHATSAPP_PATH ?? "/webhook",
      }),
    );
    tools.push(...defaultWhatsAppTools);
    context.push(...defaultWhatsAppContext);
  }

  if (adapters.length === 0) {
    console.error(
      "No platform secrets found. Set SLACK_BOT_TOKEN + SLACK_APP_TOKEN, " +
        "DISCORD_BOT_TOKEN + DISCORD_APP_ID, TELEGRAM_BOT_TOKEN, " +
        "and/or the WHATSAPP_* vars (see README).",
    );
    process.exit(1);
  }

  const bot = createBot({
    adapters,
    // One AG-UI agent per conversation. The backend is a CopilotKit
    // `BuiltInAgent` (CopilotSseRuntime), which does NOT require a UUID-format
    // threadId, so the raw conversation thread id is fine.
    // `SanitizingHttpAgent` is a lenient superset of `HttpAgent` (tolerates a
    // null `parentMessageId` from `@ag-ui/langgraph`); it's safe for every
    // platform, so one factory covers Slack, Discord, Telegram, and WhatsApp alike.
    agent: (threadId) => {
      const a = new SanitizingHttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    // `appTools` adds this bot's tools (read_thread, render_*, issue/page
    // cards); the per-platform `default*Tools` add `lookup_*_user`. All are
    // plain `BotTool`s — the active adapter supplies `thread`/`message`/`user`
    // per call. `default*Context` ships tagging/formatting/thread-model
    // guidance; `appContext` adds identity + triage policy.
    tools,
    context,
    // Slash commands (`/agent`, `/triage`, `/preview`, `/file-issue`). For Slack
    // each must ALSO be declared in the app config (or paste the manifest); Discord
    // and Telegram register them up front. The engine routes by name; adapters that
    // can't take commands ignore them.
    commands: appCommands,
  });

  // The turn handler. Each adapter pre-filters ingress to the turns this bot
  // should answer — DMs, explicit mentions, and every WhatsApp message.
  // createBot is mention-preferred: a single handler covers them across every
  // active platform. `senderContext` names the
  // requesting user per `thread.platform`, so the label is correct on whichever
  // surface the turn arrived from. Additional feature demos below add their own
  // handlers for modal submissions and assistant-pane thread starts. Wrap the
  // turn so a failed run (agent backend down, network/auth error) is logged
  // and surfaced to the user instead of crashing the process or vanishing
  // silently.
  bot.onMention(async ({ thread, message }) => {
    try {
      await thread.runAgent({
        context: senderContext(message.user, thread.platform),
      });
    } catch (err) {
      console.error("[bot] agent run failed", err);
      await thread
        .post("Sorry — I hit an error handling that. Please try again.")
        .catch(() => {});
    }
  });

  // Modal demo (cont.) — handle the /file-issue submission. The handler lives in
  // `modals/file-issue.tsx` (extracted + unit-tested): it validates, then
  // fire-and-forgets the agent run so the submission can be ack'd within Slack's
  // ~3s view_submission deadline (awaiting the run blows it → Slack double-files).
  bot.onModalSubmit(FILE_ISSUE_CALLBACK, fileIssueSubmit);

  // Slack-only nicety: personalize the assistant-pane prompt chips for the
  // opener. Harmless elsewhere — `onThreadStarted` only fires from adapters
  // that emit it (Discord/Telegram/WhatsApp have no assistant pane), and
  // platforms without suggested-prompt support no-op.
  bot.onThreadStarted(async ({ thread, user }) => {
    if (!user?.name) return;
    await thread.setSuggestedPrompts([
      {
        title: `Triage ${user.name}'s issues`,
        message: "Triage my open issues",
      },
      {
        title: "What shipped this week?",
        message: "Summarize what shipped this week",
      },
    ]);
  });

  await bot.start();
  console.log(
    `[bot] started on: ${adapters.map((a) => a.platform).join(", ")}`,
  );

  const shutdown = async (signal: string) => {
    console.log(`\n[bot] received ${signal}, stopping…`);
    await bot.stop();
    // Tear down the shared headless browser used for chart/diagram rendering.
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Fail loud, not silent: surface any stray async error (e.g. a throw deep in an
// interaction/callback path) instead of letting it kill the process with no
// log. Log and keep running — one bad turn shouldn't take the bot down.
process.on("unhandledRejection", (reason) => {
  console.error("[bot] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[bot] uncaughtException:", err);
});

main().catch((err) => {
  console.error("[bot] fatal", err);
  process.exit(1);
});
