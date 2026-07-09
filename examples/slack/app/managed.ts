/**
 * Managed (Intelligence-hosted) entrypoint for the same Slack bot as
 * `app/index.ts`.
 *
 * `index.ts` is the SELF-HOSTED variant: it holds the Slack bot/app tokens and
 * talks to Slack directly via the native `slack()` adapter. This file is the
 * MANAGED variant: it holds no Slack credentials and no public endpoint — it
 * connects to the Intelligence realtime-gateway over Phoenix, receives leased
 * deliveries, and streams render frames back. Intelligence owns the Slack edge
 * (signed ingress → app-api, egress via the Connector Outbox).
 *
 * The bot itself — the agent, tools, context, commands, and turn handlers — is
 * IDENTICAL to the native bot; only the transport changes. `intelligenceAdapter`
 * is exclusive, so the managed bot is created WITHOUT a native adapter and
 * {@link startManagedBotsOverPhoenix} attaches the managed transport.
 *
 *   native:   createBot({ adapters: [slack({ botToken, appToken }) ] })  // index.ts
 *   managed:  startManagedBotsOverPhoenix([ createBot({ … }) ], { … })   // this file
 *
 * Run: `pnpm --filter slack-example managed` with the INTELLIGENCE_* env set
 * (see `.env.example`).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createBot } from "@copilotkit/channels";
import {
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/channels-slack";
import { startManagedBotsOverPhoenix } from "@copilotkit/channels-intelligence";
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
  if (!Number.isInteger(projectId) || projectId < 0) {
    console.error(
      `Invalid INTELLIGENCE_PROJECT_ID: "${process.env.INTELLIGENCE_PROJECT_ID}"`,
    );
    process.exit(1);
  }
  const botName = required("INTELLIGENCE_BOT_NAME");

  // Same bot as the native example, minus the adapter: the managed transport is
  // attached by startManagedBotsOverPhoenix. Slack is the only managed provider
  // here, so it always ships the Slack tools/context (the native example adds
  // these conditionally per active adapter).
  const bot = createBot({
    name: botName,
    agent: (threadId) => {
      const a = new SanitizingHttpAgent({ url: agentUrl, headers: agentHeaders });
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
  bot.onModalSubmit(FILE_ISSUE_CALLBACK, fileIssueSubmit);
  bot.onThreadStarted(async ({ thread, user }) => {
    if (!user?.name) return;
    await thread.setSuggestedPrompts([
      { title: `Triage ${user.name}'s issues`, message: "Triage my open issues" },
      { title: "What shipped this week?", message: "Summarize what shipped this week" },
    ]);
  });

  const handle = await startManagedBotsOverPhoenix([bot], {
    wsUrl: required("INTELLIGENCE_GATEWAY_WS_URL"),
    apiKey: required("INTELLIGENCE_API_KEY"),
    scope: {
      organizationId: required("INTELLIGENCE_ORG_ID"),
      projectId,
      botId: required("INTELLIGENCE_BOT_ID"),
      botName,
    },
    runtimeInstanceId:
      process.env.INTELLIGENCE_RUNTIME_INSTANCE_ID ??
      `rti_${randomUUID().replace(/-/g, "")}`,
    adapter: "slack",
    log: (msg, meta) => console.log(`[managed] ${msg}`, meta ?? ""),
  });
  console.log(`[bot] started managed (Phoenix) as "${botName}" on project ${projectId}`);

  const shutdown = async (signal: string) => {
    console.log(`\n[bot] received ${signal}, stopping…`);
    await handle.stop();
    await closeBrowser().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
