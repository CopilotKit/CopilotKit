/**
 * Intelligence (managed Channel) entrypoint for the same Slack bot as
 * `app/index.ts`.
 *
 * `index.ts` is the SELF-HOSTED variant: it holds the Slack bot/app tokens and
 * talks to Slack directly via the native `slack()` adapter. This file is the
 * MANAGED variant: it holds no Slack credentials and no public Slack endpoint —
 * Intelligence owns the Slack edge (signed ingress → app-api, egress via the
 * Connector Outbox) and delivers turns to this process over its realtime
 * transport.
 *
 * The bot itself — the agent, tools, context, commands, and turn handlers — is
 * IDENTICAL to the native bot; only the transport changes. Instead of a
 * launcher, the managed path now goes through the NORMAL runtime handler: you
 * hand your `createChannel(...)` to `new CopilotRuntime({ …, channels })` and
 * mount it with `createCopilotNodeListener`. Creating the listener activates
 * the managed Channel (the runtime derives every infra id — project, adapter,
 * channel — from the Intelligence config + the channel `name`, so the developer
 * supplies NONE of them):
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
import { createChannel } from "@copilotkit/channels";
import {
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/channels/slack";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
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

/**
 * Derive the Intelligence websocket base URL from the API base URL when it
 * isn't set explicitly: `http(s)://…` → `ws(s)://…`. The runner + client socket
 * URLs are derived from this by the client.
 */
const deriveWsUrl = (apiUrl: string): string =>
  apiUrl.replace(/^http(s?):\/\//, "ws$1://");

/**
 * The managed Channel `name` is chosen HERE, in code — it is the project-unique
 * identifier the runtime uses to derive the managed Channel's activation config
 * (there is no launcher and no `INTELLIGENCE_CHANNEL_*` env to supply).
 */
const channelName = "triage";

async function main() {
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
    name: channelName,
    agent: (threadId) => {
      const a = new SanitizingHttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    tools: [...appTools, ...defaultSlackTools],
    context: [...appContext, ...defaultSlackContext],
    commands: appCommands,
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
  const apiUrl = required("COPILOTKIT_INTELLIGENCE_URL");
  const intelligence = new CopilotKitIntelligence({
    apiUrl,
    wsUrl: process.env.COPILOTKIT_INTELLIGENCE_WS_URL ?? deriveWsUrl(apiUrl),
    apiKey: required("COPILOTKIT_API_KEY"),
  });

  const runtime = new CopilotRuntime({
    // The Channel supplies its own agent (the SanitizingHttpAgent above), so no
    // additional runtime-hosted agents are needed here.
    agents: {},
    intelligence,
    // Demo stub — replace with your own auth-derived user identity (e.g. OIDC)
    // before any multi-user deployment, or all users share one thread history.
    identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
    channels: [support],
  });

  // Mounting the NORMAL handler is what starts the managed Channel: the Node
  // listener creates the runtime handler (which activates the Channel over the
  // Intelligence transport) and exposes `.channels` for shutdown. There is no
  // public Slack ingress on this port — Intelligence owns the Slack edge — but
  // the server keeps the lifecycle-owning process alive.
  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
  });
  const port = Number(process.env.PORT ?? 8300);
  createServer(listener).listen(port, () => {
    console.log(
      `[channel] started managed Channel "${channelName}" (listener on :${port})`,
    );
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await listener.channels?.stop();
    } catch (err) {
      console.error("[channel] error stopping managed Channel", err);
      exitCode = 1;
    }
    // Browser teardown is best-effort, but still surface a failure rather than
    // swallow it silently.
    await closeBrowser().catch((err: unknown) =>
      console.error(
        "[channel] browser cleanup failed (continuing shutdown)",
        err,
      ),
    );
    process.exit(exitCode);
  };
  // A failed shutdown must not vanish — log it and exit nonzero.
  const runShutdown = (signal: string): void => {
    shutdown(signal).catch((err: unknown) => {
      console.error(`[channel] fatal during ${signal} shutdown`, err);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => runShutdown("SIGINT"));
  process.on("SIGTERM", () => runShutdown("SIGTERM"));
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
