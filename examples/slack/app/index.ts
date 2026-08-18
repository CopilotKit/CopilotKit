/**
 * The bot _application_ — user-land code, not SDK code. The companion
 * `runtime.ts` holds the AG-UI agent backend (a CopilotKit `BuiltInAgent`
 * wired to the Linear + Notion MCP servers); this directory holds everything
 * that runs on the chat-platform side of the bot for this deployment.
 *
 * MULTI-PLATFORM: this single app drives Slack, Discord, Telegram, and/or
 * WhatsApp from one process. `@copilotkit/channels`'s `createChannel` accepts an array
 * of adapters, so we include each platform's adapter only when its secrets are
 * present. Drop in `SLACK_*` to run Slack, `DISCORD_*` for Discord,
 * `TELEGRAM_BOT_TOKEN` for Telegram, `WHATSAPP_*` for WhatsApp — or any
 * combination to run them at once. The rest of `app/` (tools, components, HITL,
 * rendering) is platform-agnostic and shared verbatim.
 *
 * RUN MODEL — a Channel runs ONLY through the Intelligence runtime, so this
 * example needs an Intelligence key (free tier: `COPILOTKIT_API_KEY`; the
 * platform URLs default to the managed service). The platform adapters stay DIRECT (they keep their own
 * Slack/Discord/Telegram/WhatsApp credentials + transports); the runtime OWNS
 * the Channel's lifecycle and STARTS all of its direct adapters for us. So all
 * four platforms stay on the ONE Channel — you declare it on
 * `new CopilotRuntime({ intelligence, identifyUser, channels: [bot] })` and mount
 * a node listener — which starts the Channel. `listener.channels.ready()` waits
 * for it to be live and `.stop()` tears it down. There is no
 * `bot.start()`/`bot.stop()` and no standalone path.
 *
 * Defaults are not auto-applied — you spread them explicitly. That's
 * deliberate: there's no hidden behavior, and the canonical pattern is right
 * here in the file you copy from to start a new bot.
 */
import "dotenv/config";
import { createServer } from "node:http";
import { createChannel, HttpAgent } from "@copilotkit/channels";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import type {
  PlatformAdapter,
  ChannelTool,
  ContextEntry,
} from "@copilotkit/channels";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/channels/slack";
import {
  discord,
  defaultDiscordTools,
  defaultDiscordContext,
} from "@copilotkit/channels/discord";
import {
  telegram,
  defaultTelegramTools,
  defaultTelegramContext,
} from "@copilotkit/channels/telegram";
import {
  whatsapp,
  defaultWhatsAppTools,
  defaultWhatsAppContext,
} from "@copilotkit/channels/whatsapp";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { loadBrandRender } from "./render/brand.js";
import { senderContext } from "./sender-context.js";
import { fileIssueSubmit, FILE_ISSUE_CALLBACK } from "./modals/file-issue.js";

const firstEnv = (...names: string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
};

const required = (...names: string[]): string => {
  const value = firstEnv(...names);
  if (!value) {
    console.error(`Missing required env var: ${names.join(" or ")}`);
    process.exit(1);
  }
  return value;
};

/** Prefer a key that carries `cpk-{projectId}_...`. OpenTag's COPILOTKIT_API_KEY uses `cpk_` and cannot activate a Channel. */
function intelligenceApiKey(): string {
  const candidates = [
    firstEnv("INTELLIGENCE_API_KEY"),
    firstEnv("COPILOTKIT_API_KEY"),
  ].filter((value): value is string => Boolean(value));
  const matching = candidates.find((key) => /^cpk-\d+_/.test(key));
  if (matching) return matching;
  return required("INTELLIGENCE_API_KEY", "COPILOTKIT_API_KEY");
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
  const tools: ChannelTool[] = [...appTools];
  const context: ContextEntry[] = [...appContext];
  // CopilotKit brand render config: the compiled Tailwind stylesheet + Plus
  // Jakarta Sans, fed to every image post so cards/charts render on-brand.
  const brand = await loadBrandRender();

  if (have("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN")) {
    adapters.push(
      slack({
        botToken: required("SLACK_BOT_TOKEN"),
        appToken: required("SLACK_APP_TOKEN"),
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
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
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

  const bot = createChannel({
    identifyUser: "platform",
    // Every declared Channel needs a unique `name` — the Intelligence runtime
    // keys its lifecycle by it. All four platforms ride this ONE Channel; the
    // runtime starts each of its direct adapters when the Channel activates.
    name: "triage",
    adapters,
    // One AG-UI agent per conversation. The backend is a CopilotKit
    // `BuiltInAgent` (CopilotSseRuntime), which does NOT require a UUID-format
    // threadId, so the raw conversation thread id is fine. Nothing here is
    // platform-specific, so one factory covers Slack, Discord, Telegram, and
    // WhatsApp alike.
    agent: (threadId) => {
      const a = new HttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    // `appTools` adds this bot's tools (read_thread, render_*, issue/page
    // cards); the per-platform `default*Tools` add `lookup_*_user`. All are
    // plain `ChannelTool`s — the active adapter supplies `thread`/`message`/`user`
    // per call. `default*Context` ships tagging/formatting/thread-model
    // guidance; `appContext` adds identity + triage policy.
    tools,
    context,
    // Slash commands (`/agent`, `/triage`, `/preview`, `/file-issue`). For Slack
    // each must ALSO be declared in the app config (or paste the manifest); Discord
    // and Telegram register them up front. The engine routes by name; adapters that
    // can't take commands ignore them.
    commands: appCommands,
    // Takumi image rendering config, CopilotKit-branded. `brand.stylesheets` is
    // the compiled Tailwind sheet (styles/brand.css) whose classes the cards use;
    // `brand.fonts` is Plus Jakarta Sans (the brand typeface) loaded from
    // assets/fonts. Charts render in the brand data-viz palette by default.
    render: {
      width: 760,
      stylesheets: brand.stylesheets,
      fonts: brand.fonts,
    },
  });

  // The turn handler. Each adapter pre-filters ingress to the turns this bot
  // should answer — DMs, explicit mentions, and every WhatsApp message.
  // createChannel is mention-preferred: a single handler covers them across every
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
      console.error("[channel] agent run failed", err);
      await thread
        .post("Sorry — I hit an error handling that. Please try again.")
        .catch((postErr: unknown) =>
          console.error("[channel] failed to post agent error", postErr),
        );
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

  // The Intelligence client the Channel-owning runtime is configured with. A
  // Channel runs only through the Intelligence runtime — the direct adapters
  // keep their own platform credentials, but the runtime is what starts them.
  // apiUrl/wsUrl default to CopilotKit's managed Intelligence platform; the env
  // overrides target a self-hosted or dev deployment. Set both or neither: the
  // API and realtime planes are separate hosts (api.… vs realtime.…), so
  // neither can be derived from the other.
  const intelligence = new CopilotKitIntelligence({
    apiUrl: firstEnv("COPILOTKIT_INTELLIGENCE_URL", "INTELLIGENCE_API_URL"),
    wsUrl: firstEnv(
      "COPILOTKIT_INTELLIGENCE_WS_URL",
      "INTELLIGENCE_GATEWAY_WS_URL",
    ),
    apiKey: intelligenceApiKey(),
  });

  // Declare the Channel on the Intelligence runtime, which OWNS its lifecycle:
  // because Intelligence is configured, it starts EVERY direct adapter on the
  // Channel (Slack + Discord + Telegram + WhatsApp alike) — there is no
  // `bot.start()`. The runtime hosts no agents itself; the Channel supplies its
  // own (the HttpAgent above), so `agents` is empty.
  const channelRuntime = new CopilotRuntime({
    agents: {},
    intelligence,
    channels: [bot],
  });

  // Teardown is wired BEFORE the listener exists, because creating the listener
  // is what starts the Channel: `stopChannels` is assigned in the same tick as
  // the creation below, so a Ctrl-C can never land in a window where the Channel
  // is connecting but nothing knows how to tear it down.
  let stopChannels: (() => Promise<void>) | undefined;

  const shutdown = async (signal: string) => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      // Stop through the runtime's Channel control, which tears down every direct
      // adapter it started.
      await stopChannels?.();
    } catch (err) {
      console.error("[channel] error stopping Channel", err);
      exitCode = 1;
    }
    process.exit(exitCode);
  };
  // A failed shutdown must not vanish, and must not leave the process alive: a
  // rejection here would otherwise skip `process.exit` entirely and hang Ctrl-C.
  const runShutdown = (signal: string): void => {
    shutdown(signal).catch((err: unknown) => {
      console.error(`[channel] fatal during ${signal} shutdown`, err);
      process.exit(1);
    });
  };
  // Registered BEFORE activation on purpose: activation begins the moment the
  // listener is created and `ready()` below can take up to its timeout — a
  // Ctrl-C anywhere in that window must still tear the Channel down rather than
  // hit Node's default handler and skip teardown.
  process.on("SIGINT", () => runShutdown("SIGINT"));
  process.on("SIGTERM", () => runShutdown("SIGTERM"));

  // Mounting the Node listener creates the runtime handler and STARTS the Channel
  // (connecting all its direct adapters); `.channels` is how you observe and stop
  // it. This listener holds the Intelligence key and needs no public ingress
  // (each platform adapter has its own — e.g. WhatsApp's webhook on $PORT); it
  // only owns the Channel lifecycle and keeps the process alive.
  const channelPort = Number(process.env.CHANNELS_PORT ?? 8300);
  const listener = createCopilotNodeListener({
    runtime: channelRuntime,
    basePath: "/api/copilotkit",
  });
  stopChannels = () => listener.channels.stop();
  createServer(listener).listen(channelPort, "127.0.0.1", () => {
    console.log(
      `[channel] runtime (owns lifecycle) listening on 127.0.0.1:${channelPort}`,
    );
  });

  // Wait for the activation started above to settle, instead of a (now-removed)
  // bot.start(): this resolves once every direct adapter's transport is up across
  // all active platforms, and rejects if one failed — so a broken deploy exits
  // non-zero instead of pretending to be a live bot.
  // Bound it so a wedged adapter connect can't hang readiness forever.
  await listener.channels.ready({ timeoutMs: 30_000 });
  console.log(
    `[channel] started on: ${adapters.map((a) => a.platform).join(", ")}`,
  );
}

// Fail loud, not silent: surface any stray async error (e.g. a throw deep in an
// interaction/callback path) instead of letting it kill the process with no
// log. Log and keep running — one bad turn shouldn't take the bot down.
process.on("unhandledRejection", (reason) => {
  console.error("[channel] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[channel] uncaughtException:", err);
});

main().catch((err) => {
  console.error("[channel] fatal", err);
  process.exit(1);
});
