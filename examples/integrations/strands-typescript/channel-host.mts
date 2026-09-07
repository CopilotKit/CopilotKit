/**
 * Channel host — a second mount over the SAME agent the web route serves.
 *
 * The runtime route answers HTTP for the web app. This process holds an
 * Intelligence Channel open (Slack, Teams, ...) and delivers its turns to that
 * same agent.
 *
 * It holds NO provider credentials and exposes NO provider endpoint:
 * Intelligence owns the provider edge and delivers turns over its realtime
 * transport. The Channel itself lives in `channels.mts` — this file is only the
 * process that owns its lifetime, and is identical in every starter and for
 * every provider.
 *
 * There is no HTTP server here. Nothing calls this process: the gateway
 * connection is outbound, and holding it open is what keeps the process alive.
 * A production deployment usually adds a health endpoint reporting
 * `channels.status()` — see the "Deploy and operate" Channels docs.
 *
 * Run: `npm run channel`
 */
import "dotenv/config";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createDefaultChannel, resolveChannelName } from "./channels.mjs";

/** Reads a required env var, or exits naming the one that is missing. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[channel] missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const channelName = resolveChannelName();

  const runtime = new CopilotRuntime({
    // The Channel supplies its own agent, so no runtime-hosted agents are needed.
    agents: {},
    channels: [createDefaultChannel(channelName)],
    intelligence: new CopilotKitIntelligence({
      apiKey: required("CPK_INTELLIGENCE_API_KEY"),
      ...(process.env.INTELLIGENCE_API_URL
        ? { apiUrl: process.env.INTELLIGENCE_API_URL }
        : {}),
      ...(process.env.INTELLIGENCE_GATEWAY_WS_URL
        ? { wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL }
        : {}),
    }),
  });

  // This handler is deliberately never served. It is the documented
  // long-running-host entry point: creating it opens nothing, and the `ready()`
  // below is what activates the Channel.
  const handler = createCopilotRuntimeHandler({ runtime });

  // Teardown is wired before activation starts, so a Ctrl-C during the connect
  // window still tears the gateway session down instead of orphaning it.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await handler.channels.stop();
    } catch (err) {
      console.error("[channel] error stopping Channel", err);
      exitCode = 1;
    }
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

  // Bounded, so a wedged connect cannot hang startup forever and a failure exits
  // non-zero instead of looking live. A rejection here (e.g. a Channel in
  // `error`) still falls through to the top-level `.catch` below and exits
  // non-zero.
  await handler.channels.ready({ timeoutMs: 30_000 });

  // `ready()` resolving only means every Channel reached a terminal,
  // non-connecting state — that includes `setup_required`, where nothing is
  // actually attached yet. Report what `status()` says is true, not what we
  // hoped would be true, so an unfinished setup reads as unfinished instead
  // of as success.
  const { channels: channelStatuses } = handler.channels.status();
  const thisStatus = channelStatuses[channelName];
  if (thisStatus === "online") {
    console.log(`[channel] Channel "${channelName}" is online.`);
  } else if (thisStatus === "setup_required") {
    console.log(
      `[channel] Channel "${channelName}" is declared but no provider is attached yet.\n` +
        "  This is a normal waiting state, not an error — run `copilotkit channels status` " +
        "to see what setup remains before it can send or receive messages.",
    );
  } else {
    // ready() only resolves once every Channel is `online` or `setup_required`,
    // so this should be unreachable — but report the truth if it ever isn't.
    console.log(
      `[channel] Channel "${channelName}" settled to unexpected status "${thisStatus}".`,
    );
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[channel] unhandledRejection:", reason);
});

main().catch((err: unknown) => {
  console.error("[channel] fatal: failed to start Channel", err);
  process.exit(1);
});
