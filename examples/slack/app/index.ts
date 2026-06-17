/**
 * This file is the Slack agent _application_ — user-land code, not SDK
 * code. The companion `runtime.ts` holds the AG-UI agent backend (a
 * CopilotKit `BuiltInAgent` wired to the Linear + Notion MCP servers);
 * this directory holds everything that runs on the Slack side of the
 * bot for this specific deployment.
 *
 * Defaults are not auto-applied — you spread them explicitly. That's
 * deliberate: there's no hidden behavior, and the canonical pattern
 * (below) is right there in the file you copy from to start a new bot.
 */
import "dotenv/config";
import { createBot } from "@copilotkit/bot";
import {
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/bot-slack";
import { defaultWhatsAppContext } from "@copilotkit/bot-whatsapp";
import { buildAdapters } from "./adapters.js";
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

async function main() {
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  const bot = createBot({
    adapters: buildAdapters(process.env),
    // One AG-UI agent per conversation. The backend is a CopilotKit
    // `BuiltInAgent` (CopilotSseRuntime), which does NOT require a
    // UUID-format threadId, so the raw conversation thread id is fine.
    // (The old LangGraph bridge hashed it to a UUID; not needed here.)
    agent: (threadId) => {
      const a = new SanitizingHttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    // `defaultSlackTools` ships `lookup_slack_user` (used for @-mentions);
    // `appTools` adds this bot's tools (read_thread, render_*, issue/page
    // cards). Both are plain `BotTool`s whose handler receives the generic
    // `BotToolContext`; the adapter supplies `thread`/`message`/`user` per
    // call and tools reach platform power via `thread` methods, so no cast
    // is needed. Platform-formatting context (Slack mrkdwn / WhatsApp markdown)
    // is injected per-turn in onMention; `appContext` adds identity + triage policy.
    tools: [...defaultSlackTools, ...appTools],
    context: [...appContext],
    // Slash commands (`/agent`, `/triage`). Each must ALSO be declared in the
    // Slack app config to actually fire — see README. The adapter forwards
    // every received command; the engine routes by name.
    commands: appCommands,
  });

  // Register ONLY onMention. The Slack listener already pre-filters ingress
  // to the turns this bot should answer — @-mentions, replies in threads it
  // owns, and DMs — and an `IncomingTurn` carries no mention/message
  // distinction. createBot is mention-preferred: when any mention handler is
  // registered it routes ALL turns to it. So this single handler covers
  // mentions, owned-thread replies, AND DMs; a second onMessage handler would
  // never fire (and registering both would risk double-handling).
  // One handler covers every surface. createBot is mention-preferred, so all
  // turns (Slack mentions/DMs/owned-thread replies AND WhatsApp messages) route
  // here. The platform-formatting context is chosen per-turn from thread.platform.
  bot.onMention(async ({ thread, message }) => {
    const platformCtx =
      thread.platform === "whatsapp"
        ? defaultWhatsAppContext
        : defaultSlackContext;
    await thread.runAgent({
      context: [
        ...platformCtx,
        ...senderContext(message.user, thread.platform),
      ],
    });
  });

  await bot.start();

  const shutdown = async (signal: string) => {
    console.log(`\n[slack-bot] received ${signal}, stopping…`);
    await bot.stop();
    // Tear down the shared headless browser used for chart/diagram rendering.
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[slack-bot] fatal", err);
  process.exit(1);
});
