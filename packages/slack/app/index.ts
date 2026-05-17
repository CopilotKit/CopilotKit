/**
 * This file is the Slack agent _application_ — user-land code, not SDK
 * code. The companion `agent/` directory holds the (Python) AG-UI agent
 * backend; this directory holds everything that runs on the Slack side
 * of the bridge for this specific bot.
 *
 * Defaults are not auto-applied — you spread them explicitly. That's
 * deliberate: there's no hidden behavior, and the canonical pattern
 * (below) is right there in the file you copy from to start a new bot.
 */
import "dotenv/config";
import {
  createSlackBridge,
  defaultSlackTools,
  defaultSlackContext,
} from "../src/index.js";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appComponents } from "./components/index.js";
import { appHitl } from "./human-in-the-loop/index.js";
import { appInterruptHandlers } from "./interrupts/index.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
};

async function main() {
  const bridge = createSlackBridge({
    agentUrl: required("AGENT_URL"),
    slackBotToken: required("SLACK_BOT_TOKEN"),
    slackAppToken: required("SLACK_APP_TOKEN"),
    agentHeaders: process.env.AGENT_AUTH_HEADER
      ? { Authorization: process.env.AGENT_AUTH_HEADER }
      : undefined,
    // `defaultSlackTools` ships `lookup_slack_user` (used for @-mentions).
    // `defaultSlackContext` ships tagging/mrkdwn/thread-model guidance.
    // Spread both, then add anything app-specific on top.
    tools: [...defaultSlackTools, ...appTools],
    context: [...defaultSlackContext, ...appContext],
    // Agent-renderable Block Kit components (the Slack equivalent of
    // React's `useComponent`). The bridge auto-converts each to a
    // frontend tool whose `execute` posts the rendered blocks.
    components: appComponents,
    // Interactive components (the Slack equivalent of React's
    // `useHumanInTheLoop`). The agent calls these like tools; they
    // render Block Kit buttons and the tool call blocks until the user
    // clicks. The bridge then resolves with the chosen action so the
    // agent run continues with the user's decision in scope.
    humanInTheLoopComponents: appHitl,
    // LangGraph `interrupt()` handlers (the Slack equivalent of React's
    // `useInterrupt`). When the agent graph pauses at an `interrupt()`
    // call, the bridge dispatches to a matching handler to render a
    // Block Kit picker; clicks resume the graph via forwardedProps.command.
    interruptHandlers: appInterruptHandlers,
  });

  await bridge.start();

  const shutdown = async (signal: string) => {
    console.log(`\n[slack-bridge] received ${signal}, stopping…`);
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[slack-bridge] fatal", err);
  process.exit(1);
});
