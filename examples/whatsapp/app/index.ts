/**
 * This file is the WhatsApp bot _application_ — user-land code, not SDK
 * code. The companion `runtime.ts` holds the AG-UI agent backend (a
 * CopilotKit `BuiltInAgent` wired to the Linear + Notion MCP servers);
 * this directory holds everything that runs on the WhatsApp side of the
 * bot for this specific deployment.
 *
 * Defaults are not auto-applied — you spread them explicitly. That's
 * deliberate: there's no hidden behavior, and the canonical pattern
 * (below) is right there in the file you copy from to start a new bot.
 */
import "dotenv/config";
import { createBot } from "@copilotkit/bot";
import { whatsapp, defaultWhatsAppContext } from "@copilotkit/bot-whatsapp";
import { makeAgent } from "./agent.js";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";

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
      whatsapp({
        accessToken: required("WHATSAPP_ACCESS_TOKEN"),
        phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
        appSecret: required("WHATSAPP_APP_SECRET"),
        verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
        port: process.env.WHATSAPP_PORT
          ? Number(process.env.WHATSAPP_PORT)
          : 3000,
        path: process.env.WHATSAPP_PATH ?? "/webhook",
      }),
    ],
    agent: makeAgent(agentUrl, agentHeaders),
    tools: [...appTools],
    context: [...defaultWhatsAppContext, ...appContext],
    commands: appCommands,
  });

  // WhatsApp has no mention concept; every inbound text turn is for the bot.
  bot.onMessage(async ({ thread }) => {
    try {
      await thread.runAgent();
    } catch (err) {
      // Fail loud to the user instead of leaving them with silence.
      console.error("[whatsapp-bot] turn failed:", err);
      try {
        await thread.post({
          type: "section",
          props: {
            children:
              "⚠️ Sorry — something went wrong handling that. Please try again.",
          },
        });
      } catch (postErr) {
        console.error("[whatsapp-bot] error-reply also failed:", postErr);
      }
    }
  });

  await bot.start();
  console.log("[whatsapp-bot] listening for webhooks");

  const shutdown = async (signal: string) => {
    console.log(`\n[whatsapp-bot] received ${signal}, stopping…`);
    await bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[whatsapp-bot] fatal", err);
  process.exit(1);
});
