/**
 * Slack bot over CopilotKit Intelligence. Intelligence owns the Slack edge
 * (ingress and egress). This process has no Slack bot token and does not
 * open Socket Mode. The runtime attaches the managed delivery adapter from
 * the Intelligence key and the Channel `name`.
 *
 * Mentions run the default triage agent. Start a message with `search:` to
 * run the named extra agent on the same thread.
 */
import "dotenv/config";
import { createServer } from "node:http";
import { createChannel } from "@copilotkit/channels";
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
import { closeBrowser } from "./render/browser.js";
import {
  httpAgentFactory,
  parseNamedAgentPrompt,
  siblingAgentRunUrl,
} from "./agents.js";

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
 * Prefer a key that carries `cpk-{projectId}_...`. Some COPILOTKIT_API_KEY
 * values use `cpk_` and cannot activate a Channel.
 */
function intelligenceApiKey(): string {
  const candidates = [
    firstEnv("INTELLIGENCE_API_KEY"),
    firstEnv("COPILOTKIT_API_KEY"),
  ].filter((value): value is string => Boolean(value));
  const matching = candidates.find((key) => /^cpk-\d+_/.test(key));
  if (matching) return matching;
  return required("INTELLIGENCE_API_KEY", "COPILOTKIT_API_KEY");
}

const channelName = firstEnv("INTELLIGENCE_CHANNEL_NAME") ?? "triage";

async function main() {
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  const bot = createChannel({
    identifyUser: "platform",
    name: channelName,
    agent: httpAgentFactory(agentUrl, agentHeaders),
    agents: {
      search: httpAgentFactory(
        siblingAgentRunUrl(agentUrl, "search"),
        agentHeaders,
      ),
    },
    tools: [...appTools, ...defaultSlackTools],
    context: [...appContext, ...defaultSlackContext],
    commands: appCommands,
  });

  bot.onMention(async ({ thread, message }) => {
    try {
      // Managed history does not include the in-flight turn. Pass prompt.
      const picked = parseNamedAgentPrompt(message.text);
      await thread.runAgent({
        agentId: picked.agentId,
        prompt: message.contentParts?.length
          ? message.contentParts
          : picked.prompt,
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

  const intelligence = new CopilotKitIntelligence({
    apiUrl: firstEnv("COPILOTKIT_INTELLIGENCE_URL", "INTELLIGENCE_API_URL"),
    wsUrl: firstEnv(
      "COPILOTKIT_INTELLIGENCE_WS_URL",
      "INTELLIGENCE_GATEWAY_WS_URL",
    ),
    apiKey: intelligenceApiKey(),
  });

  const channelRuntime = new CopilotRuntime({
    agents: {},
    intelligence,
    channels: [bot],
  });

  let stopChannels: (() => Promise<void>) | undefined;

  const shutdown = async (signal: string) => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await stopChannels?.();
    } catch (err) {
      console.error("[channel] error stopping Channel", err);
      exitCode = 1;
    }
    await closeBrowser().catch((err: unknown) =>
      console.error(
        "[channel] browser cleanup failed (continuing shutdown)",
        err,
      ),
    );
    process.exit(exitCode);
  };
  const runShutdown = (signal: string): void => {
    shutdown(signal).catch((err: unknown) => {
      console.error(`[channel] fatal during ${signal} shutdown`, err);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => runShutdown("SIGINT"));
  process.on("SIGTERM", () => runShutdown("SIGTERM"));

  const channelPort = Number(
    process.env.CHANNELS_PORT ?? process.env.PORT ?? 8300,
  );
  const listener = createCopilotNodeListener({
    runtime: channelRuntime,
    basePath: "/api/copilotkit",
  });
  stopChannels = () => listener.channels.stop();
  createServer(listener).listen(channelPort, () => {
    console.log(`[channel] intelligence listener on :${channelPort}`);
  });

  await listener.channels.ready({ timeoutMs: 30_000 });
  console.log(`[channel] started managed Slack Channel "${channelName}"`);
}

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
