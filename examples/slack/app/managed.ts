/**
 * Default entrypoint (`pnpm dev` / `pnpm start`). Intelligence owns Slack.
 *
 * This process holds no Slack tokens and no public Slack endpoint.
 * Intelligence owns the Slack edge (signed ingress, egress via the Connector
 * Outbox) and delivers turns here over its realtime transport.
 *
 * `app/index.ts` is the optional self-hosted path (`pnpm direct`): it holds
 * Slack/Discord/Telegram/WhatsApp tokens and talks to those platforms
 * directly. Use that only when you want local adapters.
 *
 * The bot itself — the agent, tools, context, commands, and turn handlers — is
 * IDENTICAL to the native bot; only the transport changes. Instead of a
 * launcher, the managed path now goes through the NORMAL runtime handler: you
 * hand your `createChannel(...)` to `new CopilotRuntime({ …, channels })` and
 * mount it with `createCopilotNodeListener` — which activates the managed Channel
 * — then `await listener.channels.ready()` to wait until it is live (the runtime
 * derives every infra id — project, adapter, channel — from the Intelligence
 * config + the channel `name`, so the developer supplies NONE of them):
 *
 *   native:   createChannel({ adapters: [slack({ botToken, appToken }) ] })   // index.ts
 *   managed:  new CopilotRuntime({ intelligence, identifyUser, channels })     // this file
 *             + createCopilotNodeListener({ runtime })
 *
 * Run: `pnpm --filter slack-example channel` with the intelligence config env
 * set (see `.env.example`).
 */
import "dotenv/config";
import { createServer } from "node:http";
import { createChannel, HttpAgent } from "@copilotkit/channels";
import {
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/channels/slack";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { senderContext } from "./sender-context.js";
import { fileIssueSubmit, FILE_ISSUE_CALLBACK } from "./modals/file-issue.js";
import { loadBrandRender } from "./render/brand.js";

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

/**
 * Channel name on the Intelligence project. Defaults to `triage`. Set
 * `INTELLIGENCE_CHANNEL_NAME` to attach to an existing managed Channel
 * (for example the OpenTag Slack app).
 */
const channelName = firstEnv("INTELLIGENCE_CHANNEL_NAME") ?? "triage";

async function main() {
  const brand = await loadBrandRender();
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  // Same Slack Bot as the native example, minus the adapter: the managed
  // transport is attached by the runtime when the handler activates the
  // Channel. Slack is the only managed provider here, so it always ships the
  // Slack tools/context (the native example adds these conditionally per active
  // adapter).
  const support = createChannel({
    identifyUser: "platform",
    name: channelName,
    agent: (threadId) => {
      const a = new HttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    tools: [...appTools, ...defaultSlackTools],
    context: [...appContext, ...defaultSlackContext],
    commands: appCommands,
    render: {
      width: 760,
      stylesheets: brand.stylesheets,
      fonts: brand.fonts,
    },
  });

  // Turn + feature handlers — identical to the native example (app/index.ts).
  support.onMention(async ({ thread, message }) => {
    try {
      // Channel history (app-api /api/channels/history) does NOT include the
      // in-flight turn (unlike native adapters whose getHistory rebuilds the
      // live thread), so pass the current message explicitly as `prompt` —
      // otherwise runAgent runs with zero messages. Prefer multimodal parts.
      await thread.runAgent({
        prompt: message.contentParts?.length
          ? message.contentParts
          : message.text,
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
  support.onModalSubmit(FILE_ISSUE_CALLBACK, fileIssueSubmit);
  support.onThreadStarted(async ({ thread, user }) => {
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

  // The Intelligence client. It holds the managed edge credentials; from these
  // (plus the channel `name`) the runtime derives the managed Channel's
  // activation config — project id, adapter, socket URL/auth — with no infra
  // ids supplied by the developer.
  // apiUrl/wsUrl default to CopilotKit's managed Intelligence platform; the env
  // overrides target a self-hosted or dev deployment. Set both or neither: the
  // API and realtime planes are separate hosts (api.… vs realtime.…), so
  // neither can be derived from the other.
  const intelligence = new CopilotKitIntelligence({
    apiUrl: firstEnv(
      "COPILOTKIT_INTELLIGENCE_URL",
      "INTELLIGENCE_API_URL",
    ),
    wsUrl: firstEnv(
      "COPILOTKIT_INTELLIGENCE_WS_URL",
      "INTELLIGENCE_GATEWAY_WS_URL",
    ),
    apiKey: required("COPILOTKIT_API_KEY", "INTELLIGENCE_API_KEY"),
  });

  const runtime = new CopilotRuntime({
    // The Channel supplies its own agent (the HttpAgent above), so no
    // additional runtime-hosted agents are needed here.
    agents: {},
    intelligence,
    channels: [support],
  });

  // Teardown is wired BEFORE the listener exists, because creating the listener
  // is what activates the managed Channel; `stopChannels` is assigned in the same
  // tick as that creation, so no signal can land in an untearable window.
  let stopChannels: (() => Promise<void>) | undefined;

  const shutdown = async (signal: string) => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await stopChannels?.();
    } catch (err) {
      console.error("[channel] error stopping managed Channel", err);
      exitCode = 1;
    }
    process.exit(exitCode);
  };
  // A failed shutdown must not vanish — log it and exit nonzero.
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

  // The NORMAL handler is what runs the managed Channel: creating the Node
  // listener activates it over the Intelligence transport and exposes `.channels`
  // to observe or stop it. There is no public Slack ingress on this port —
  // Intelligence owns the Slack edge — but the server keeps the lifecycle-owning
  // process alive.
  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
  });
  stopChannels = () => listener.channels.stop();
  const port = Number(process.env.PORT ?? 8300);
  // Fail loud on a malformed PORT rather than letting `Number("abc")` → NaN
  // (or an out-of-range value) reach `server.listen()` and silently bind a
  // random/wrong port that still comes up "healthy".
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      `Invalid PORT: "${process.env.PORT}" is not a valid port number`,
    );
    process.exit(1);
  }
  createServer(listener).listen(port, () => {
    console.log(`[channel] listener on :${port}`);
  });

  // Wait for that activation to settle, bounded so a wedged connect can't hang
  // startup forever — and so a failure exits non-zero instead of looking live.
  await listener.channels.ready({ timeoutMs: 30_000 });
  console.log(`[channel] started managed Channel "${channelName}"`);
}

// Fail loud, not silent: surface any stray async error instead of letting it
// kill the process with no log (mirrors the native entrypoint).
process.on("unhandledRejection", (reason) => {
  console.error("[channel] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[channel] uncaughtException:", err);
});

main().catch((err: unknown) => {
  console.error("[channel] fatal: failed to start managed Channel", err);
  process.exit(1);
});
