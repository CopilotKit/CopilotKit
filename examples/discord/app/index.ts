/**
 * This file is the Discord agent _application_ — user-land code, not SDK
 * code. The companion `runtime.ts` holds the AG-UI agent backend (a
 * CopilotKit `BuiltInAgent` wired to the Linear + Notion MCP servers);
 * this directory holds everything that runs on the Discord side of the
 * bot for this specific deployment.
 *
 * Defaults are not auto-applied — you spread them explicitly. That's
 * deliberate: there's no hidden behavior, and the canonical pattern
 * (below) is right there in the file you copy from to start a new bot.
 *
 * NOTE: Unlike the Slack bot, the agent here is a plain `HttpAgent` from
 * `@ag-ui/client` rather than a `SanitizingHttpAgent` — that class lives
 * in `@copilotkit/bot-slack` and is not exported from `@copilotkit/bot-discord`.
 * `SanitizingHttpAgent` bypasses strict Zod re-validation to tolerate null
 * `parentMessageId` fields from `@ag-ui/langgraph`. If the Discord bot ever
 * needs the same workaround, copy `sanitizing-http-agent.ts` from the slack
 * package into this example and import it locally.
 */
import "dotenv/config";
import { HttpAgent } from "@ag-ui/client";
import { createBot } from "@copilotkit/bot";
import {
  discord,
  defaultDiscordTools,
  defaultDiscordContext,
} from "@copilotkit/bot-discord";
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

async function main() {
  const agentUrl = required("AGENT_URL");
  const agentHeaders = process.env.AGENT_AUTH_HEADER
    ? { Authorization: process.env.AGENT_AUTH_HEADER }
    : undefined;

  const bot = createBot({
    adapters: [
      discord({
        botToken: required("DISCORD_BOT_TOKEN"),
        appId: required("DISCORD_APP_ID"),
        guildId: process.env.DISCORD_GUILD_ID,
      }),
    ],
    // One AG-UI agent per Discord conversation. The backend is a CopilotKit
    // `BuiltInAgent` (CopilotSseRuntime), which does NOT require a
    // UUID-format threadId, so the raw conversation thread id is fine.
    // (The old LangGraph bridge hashed it to a UUID; not needed here.)
    agent: (threadId) => {
      const a = new HttpAgent({
        url: agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    // `defaultDiscordTools` ships `lookup_discord_user` (used for @-mentions);
    // `appTools` adds this bot's tools. Both are plain `BotTool`s whose handler
    // receives the generic `BotToolContext`; the adapter supplies
    // `thread`/`message`/`user` per call and tools reach platform power via
    // `thread` methods, so no cast is needed. `defaultDiscordContext` ships
    // tagging/markdown/thread-model guidance; `appContext` adds identity +
    // triage policy.
    tools: [...defaultDiscordTools, ...appTools],
    context: [...defaultDiscordContext, ...appContext],
    // Slash commands (`/agent`, `/triage`). Each must ALSO be declared in the
    // Discord app config to actually fire — see README. The adapter forwards
    // every received command; the engine routes by name.
    commands: appCommands,
  });

  // Register ONLY onMention. The Discord listener already pre-filters ingress
  // to the turns this bot should answer — @-mentions, replies in threads it
  // owns, and DMs — and an `IncomingTurn` carries no mention/message
  // distinction. createBot is mention-preferred: when any mention handler is
  // registered it routes ALL turns to it. So this single handler covers
  // mentions, owned-thread replies, AND DMs; a second onMessage handler would
  // never fire (and registering both would risk double-handling).
  bot.onMention(async ({ thread, message }) => {
    await thread.runAgent({ context: senderContext(message.user) });
  });

  await bot.start();

  const shutdown = async (signal: string) => {
    console.log(`\n[discord-bot] received ${signal}, stopping…`);
    await bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[discord-bot] fatal", err);
  process.exit(1);
});
