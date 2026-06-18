/**
 * This file is the bot _application_ — user-land code, not SDK code. The
 * companion `runtime.ts` holds the AG-UI agent backend (a CopilotKit
 * `BuiltInAgent` wired to the Linear + Notion MCP servers); this directory
 * holds everything that runs on the chat-platform side of the bot.
 *
 * One app, two platforms. The same platform-neutral app layer — components,
 * tools, app context, commands, the per-turn sender context, and the headless
 * browser used for chart/diagram rendering — drives BOTH a Slack bot and a
 * Telegram bot. Each platform gets its own `createBot` instance because the
 * platform-specific guidance (tagging procedure, formatting, conversation
 * model) ships per-platform in `defaultSlackContext` / `defaultTelegramContext`
 * and must not be mixed in one bot's shared `context`. Whichever platform's
 * credentials are present in the environment starts; you can run Slack-only,
 * Telegram-only, or both.
 *
 * Defaults are not auto-applied — you spread them explicitly. That's
 * deliberate: there's no hidden behavior, and the canonical pattern (below)
 * is right there in the file you copy from to start a new bot.
 */
import "dotenv/config";
import { createBot } from "@copilotkit/bot";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/bot-slack";
import {
  telegram,
  defaultTelegramTools,
  defaultTelegramContext,
} from "@copilotkit/bot-telegram";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { senderContext } from "./sender-context.js";
import { closeBrowser } from "./render/browser.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
};

const has = (name: string): boolean => Boolean(process.env[name]);

const GREETING = "Hi! I can triage issues, search docs, and more.";

const suggestedPrompts = [
  { title: "Triage my open issues", message: "Triage my open issues" },
  {
    title: "What shipped this week?",
    message: "Summarize what shipped this week",
  },
];

async function main() {
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  // Factory that mints a fresh AG-UI agent bound to a conversation's threadId;
  // the same factory is handed to both platform bots, and createBot caches the
  // agent per conversation. The backend is a CopilotKit `BuiltInAgent`
  // (CopilotSseRuntime), which does NOT require a UUID-format threadId, so the
  // raw conversation thread id is fine.
  const makeAgent = (threadId: string) => {
    // Fresh headers object per agent so a per-request mutation can't leak
    // across conversations or platforms.
    const a = new SanitizingHttpAgent({
      url: agentUrl,
      headers: agentHeaders ? { ...agentHeaders } : undefined,
    });
    a.threadId = threadId;
    return a;
  };

  const bots: Array<{ name: string; bot: ReturnType<typeof createBot> }> = [];

  // ── Slack bot — started when Slack credentials are present ──────────────
  if (has("SLACK_BOT_TOKEN") && has("SLACK_APP_TOKEN")) {
    const slackBot = createBot({
      adapters: [
        slack({
          botToken: required("SLACK_BOT_TOKEN"),
          appToken: required("SLACK_APP_TOKEN"),
          // Assistant-pane behavior is ON by default; this just customizes it.
          // The greeting + chips show when a user opens the pane (matching the
          // app manifest's `assistant_view`); native streaming + status need no
          // config. Pass `assistant: false` / `streaming: "legacy"` to opt out.
          assistant: {
            greeting: GREETING,
            suggestedPrompts,
          },
        }),
      ],
      agent: makeAgent,
      // `defaultSlackTools` ships `lookup_slack_user` (used for @-mentions);
      // `appTools` adds this bot's platform-neutral tools (see app/tools/index.ts
      // for the full set). `defaultSlackContext` ships Slack tagging/mrkdwn/
      // thread-model guidance; `appContext` adds platform-neutral identity +
      // triage policy.
      tools: [...defaultSlackTools, ...appTools],
      context: [...defaultSlackContext, ...appContext],
      // Slash commands (`/agent`, `/triage`). Each must ALSO be declared in the
      // Slack app config to fire — see README.
      commands: appCommands,
    });

    // The Slack listener pre-filters ingress to the turns this bot should
    // answer — @-mentions, replies in threads it owns, and DMs. createBot is
    // mention-preferred: with a mention handler registered it routes ALL such
    // turns here, so this single handler covers mentions, owned-thread replies,
    // AND DMs.
    slackBot.onMention(async ({ thread, message }) => {
      // Never let a failed turn (agent backend down, auth/network error) escape
      // the handler — that would either crash the process or leave the user in
      // silence. Log it and tell the user instead.
      try {
        await thread.runAgent({ context: senderContext(message.user) });
      } catch (err) {
        console.error("[bot] slack agent run failed", err);
        await thread
          .post("Sorry — I hit an error handling that. Please try again.")
          .catch(() => {});
      }
    });

    // When a user opens the assistant pane, personalize the prompt chips. The
    // adapter applies the static `assistant` defaults first, then this layers
    // on top.
    slackBot.onThreadStarted(async ({ thread, user }) => {
      if (!user?.name) return;
      // Personalize the first chip's title; reuse the shared defaults for the
      // rest. ("Triage my open issues" is the canonical triage command.)
      const res = await thread.setSuggestedPrompts([
        {
          title: `Triage ${user.name}'s issues`,
          message: "Triage my open issues",
        },
        ...suggestedPrompts.slice(1),
      ]);
      // setSuggestedPrompts resolves { ok, error } rather than throwing — surface
      // a failure instead of silently keeping the static defaults.
      if (!res.ok) {
        console.warn("[bot] could not set personalized prompts:", res.error);
      }
    });

    bots.push({ name: "slack", bot: slackBot });
  }

  // ── Telegram bot — started when a Telegram token is present ─────────────
  if (has("TELEGRAM_BOT_TOKEN")) {
    const telegramBot = createBot({
      adapters: [
        // No greeting/suggestedPrompts here: Telegram has no assistant-pane or
        // suggested-prompt surface, so the welcome is posted from
        // `onThreadStarted` below instead.
        telegram({ token: required("TELEGRAM_BOT_TOKEN") }),
      ],
      agent: makeAgent,
      // `defaultTelegramTools` ships the Telegram user-lookup tool; `appTools`
      // adds the same platform-neutral tools the Slack bot uses.
      // `defaultTelegramContext` ships Telegram tagging/HTML/thread-model
      // guidance; `appContext` adds the same identity + triage policy.
      tools: [...defaultTelegramTools, ...appTools],
      context: [...defaultTelegramContext, ...appContext],
      commands: appCommands,
    });

    // Same routing model as Slack — the Telegram listener pre-filters to
    // @-mentions, replies in owned threads, and DMs; mention-preferred routing
    // sends all of them here.
    telegramBot.onMention(async ({ thread, message }) => {
      // Same defensive handling as Slack — a failed turn must not crash the
      // process or vanish silently.
      try {
        await thread.runAgent({ context: senderContext(message.user) });
      } catch (err) {
        console.error("[bot] telegram agent run failed", err);
        await thread
          .post("Sorry — I hit an error handling that. Please try again.")
          .catch(() => {});
      }
    });

    // Telegram has no assistant-pane / suggested-prompt surface, so on `/start`
    // post a personalized welcome message instead.
    telegramBot.onThreadStarted(async ({ thread, user }) => {
      // thread.post rejects on failure (unlike setSuggestedPrompts) — surface a
      // failed welcome rather than letting the rejection escape the handler.
      try {
        await thread.post(
          `Welcome${user?.name ? ", " + user.name : ""}! Try: *Triage my open issues*`,
        );
      } catch (err) {
        console.warn("[bot] could not post telegram welcome:", err);
      }
    });

    bots.push({ name: "telegram", bot: telegramBot });
  }

  if (bots.length === 0) {
    console.error(
      "No chat platform configured. Set SLACK_BOT_TOKEN + SLACK_APP_TOKEN " +
        "and/or TELEGRAM_BOT_TOKEN, then restart.",
    );
    process.exit(1);
  }

  // Single graceful-teardown path for every exit route (signals AND startup
  // failure). Only the bots that actually started are stopped — `started` is
  // populated as each start() resolves, so a signal mid-startup or a partial
  // start never calls stop() on a never-started adapter (which would log a
  // spurious "error stopping"). `code` seeds the exit status, so a startup
  // failure exits non-zero even if the teardown itself succeeds.
  const started: typeof bots = [];
  let shuttingDown = false;
  const shutdown = async (reason: string, code = 0) => {
    if (shuttingDown) return; // a second signal / SIGINT+SIGTERM must not re-enter
    shuttingDown = true;
    console.log(`\n[bot] ${reason}, stopping…`);
    let failed = code !== 0;
    // Inspect each stop() result — Promise.allSettled never throws, so a bot
    // that fails to stop must be surfaced here or it exits 0 silently.
    const stopped = await Promise.allSettled(started.map((b) => b.bot.stop()));
    stopped.forEach((r, i) => {
      if (r.status === "rejected") {
        failed = true;
        console.error(
          `[bot] error stopping ${started[i]?.name ?? "bot"}`,
          r.reason,
        );
      }
    });
    // Tear down the shared headless browser used for chart/diagram rendering.
    try {
      await closeBrowser();
    } catch (err) {
      failed = true;
      console.error("[bot] error closing browser", err);
    }
    process.exit(failed ? 1 : 0);
  };
  // Register signal handlers BEFORE start() so a Ctrl-C during the (possibly
  // slow) startup still runs teardown instead of leaking the headless browser.
  process.on("SIGINT", () => void shutdown("received SIGINT"));
  process.on("SIGTERM", () => void shutdown("received SIGTERM"));

  // Start each bot, recording the ones that come up in `started` so shutdown
  // stops only those. A partial start (one bot up, another rejecting) still
  // tears down the started bot + browser instead of a bare process.exit.
  const startResults = await Promise.allSettled(
    bots.map(async (b) => {
      await b.bot.start();
      started.push(b);
    }),
  );
  if (started.length < bots.length) {
    startResults.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(
          `[bot] ${bots[i]?.name ?? "bot"} failed to start`,
          r.reason,
        );
      }
    });
    await shutdown("startup failed", 1);
    return; // unreachable: shutdown calls process.exit
  }
  console.log(`[bot] started: ${bots.map((b) => b.name).join(", ")}`);
}

// Fail loud, not silent: surface any stray async error (e.g. a throw deep in an
// interaction/callback path) instead of letting it kill the process with no log.
// We log and keep running — for a chat bot, one bad turn shouldn't take the
// whole process down.
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
