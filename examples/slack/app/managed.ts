/**
 * Intelligence Channel entrypoint for the same Slack bot as
 * `app/index.ts`.
 *
 * `index.ts` is the SELF-HOSTED variant: it holds the Slack bot/app tokens and
 * talks to Slack directly via the native `slack()` adapter. This file is the
 * Channel variant: it holds no Slack credentials and no public endpoint — it
 * connects to the Intelligence Realtime Gateway, receives leased
 * deliveries, and streams render frames back. Intelligence owns the Slack edge
 * (signed ingress → app-api, egress via the Connector Outbox).
 *
 * The bot itself — the agent, tools, context, commands, and turn handlers — is
 * IDENTICAL to the native bot; only the transport changes. `intelligenceAdapter`
 * is exclusive, so the Channel Bot is created WITHOUT a native adapter and
 * {@link startChannelsOverRealtimeGateway} attaches the Channel transport.
 *
 *   native:   createChannel({ adapters: [slack({ botToken, appToken }) ] })  // index.ts
 *   channel:  startChannelsOverRealtimeGateway([ createChannel({ … }) ], { … })   // this file
 *
 * Run: `pnpm --filter slack-example channel` with the INTELLIGENCE_* env set
 * (see `.env.example`).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createChannel } from "@copilotkit/channels";
import {
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/channels-slack";
import { startChannelsOverRealtimeGateway } from "@copilotkit/channels-intelligence";
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

async function main() {
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  const projectId = Number(required("INTELLIGENCE_PROJECT_ID"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    console.error(
      `Invalid INTELLIGENCE_PROJECT_ID: "${process.env.INTELLIGENCE_PROJECT_ID}"`,
    );
    process.exit(1);
  }
  const channelName = required("INTELLIGENCE_CHANNEL_NAME");

  // Same Slack Bot as the native example, minus the adapter: the Channel transport is
  // attached by startChannelsOverRealtimeGateway. Slack is the only Channel provider
  // here, so it always ships the Slack tools/context (the native example adds
  // these conditionally per active adapter).
  const bot = createChannel({
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
  bot.onMention(async ({ thread, message }) => {
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
  bot.onModalSubmit(FILE_ISSUE_CALLBACK, fileIssueSubmit);
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

  const handle = await startChannelsOverRealtimeGateway([bot], {
    wsUrl: required("INTELLIGENCE_GATEWAY_WS_URL"),
    apiKey: required("INTELLIGENCE_API_KEY"),
    scope: {
      organizationId: required("INTELLIGENCE_ORG_ID"),
      projectId,
      channelId: required("INTELLIGENCE_CHANNEL_ID"),
      channelName,
    },
    runtimeInstanceId:
      process.env.INTELLIGENCE_RUNTIME_INSTANCE_ID ??
      `rti_${randomUUID().replace(/-/g, "")}`,
    adapter: "slack",
    // DEBUG-ONLY logging. `meta` (and the raw `err` in the onMention catch
    // above) can contain message content/payloads — the design says telemetry
    // must not include raw message text. In production, drop this `log` or trim
    // `meta` to safe fields (ids, counts) before emitting.
    log: (msg, meta) => console.log(`[channel] ${msg}`, meta ?? ""),
  });
  console.log(
    `[channel] started over Realtime Gateway as "${channelName}" on project ${projectId}`,
  );

  const shutdown = async (signal: string) => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await handle.stop();
    } catch (err) {
      console.error("[channel] error stopping Channel runtime", err);
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
  console.error("[channel] fatal: failed to start Channel runtime", err);
  process.exit(1);
});
