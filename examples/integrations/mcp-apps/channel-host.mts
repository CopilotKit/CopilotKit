/**
 * Channel host — a second mount over the SAME agent the web route serves.
 *
 * The runtime route answers HTTP for the web app. This process holds an
 * Intelligence Channel open (Slack, Teams, ...) and delivers its turns to that
 * same agent.
 *
 * It holds NO provider credentials and exposes NO provider endpoint:
 * Intelligence owns the provider edge and delivers turns over its realtime
 * transport. `createChannel` takes no adapters here, which is why this file
 * is identical in every starter and for every provider.
 *
 * Run: `npm run channel`
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createChannel } from "@copilotkit/channels";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { createDefaultAgent } from "./app/agent";

/** Reads a required env var, or exits naming the one that is missing. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[channel] missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Resolves which declared Channel this process should host.
 *
 * `.copilotkit/channels.json` is written by the CLI and committed, so a fresh
 * clone knows the name with no local state. One declared Channel is the normal
 * case. Several is genuinely ambiguous, so it is an error naming the candidates
 * rather than a guess — hosting the wrong Channel would look like it worked.
 */
function resolveChannelName(): string {
  const fromEnv = process.env.INTELLIGENCE_CHANNEL_NAME;
  if (fromEnv) return fromEnv;

  const configPath = ".copilotkit/channels.json";

  // Read and parse are separate try blocks on purpose: a missing file and a
  // malformed one are different problems with different fixes, and conflating
  // them sends someone to re-run `channels add` when the real issue is a typo
  // in JSON they already have.
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    console.error(
      `[channel] no ${configPath} found.\n` +
        "  Run `copilotkit channels add <name>` first, or set INTELLIGENCE_CHANNEL_NAME.",
    );
    process.exit(1);
  }

  let names: string[];
  try {
    const config: unknown = JSON.parse(raw);
    const channels = (config as { channels?: { name?: string }[] }).channels;
    names = (channels ?? []).flatMap((c) => (c.name ? [c.name] : []));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[channel] ${configPath} exists but could not be parsed: ${message}`,
    );
    process.exit(1);
  }

  if (names.length === 1) return names[0];
  if (names.length === 0) {
    console.error(
      "[channel] .copilotkit/channels.json declares no Channels.\n" +
        "  Run `copilotkit channels add <name>` first.",
    );
    process.exit(1);
  }
  console.error(
    `[channel] several Channels are declared (${names.join(", ")}).\n` +
      "  Set INTELLIGENCE_CHANNEL_NAME to pick one.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const channelName = resolveChannelName();

  // No adapters and no provider tools: the transport is attached by the
  // runtime when the handler activates the Channel, and per-provider tools would
  // make this file provider-specific. `onMessage` (not `onMention`) is what makes
  // the host work on 1:1 platforms as well as multi-party ones — a non-mention
  // turn is only ever dispatched to message handlers.
  const channel = createChannel({
    identifyUser: "platform",
    name: channelName,
    agent: (threadId) => {
      const agent = createDefaultAgent();
      agent.threadId = threadId;
      return agent;
    },
  });

  channel.onMessage(async ({ thread, message }) => {
    try {
      // Channel history does not include the in-flight turn, so pass the current
      // message explicitly — otherwise the agent runs with zero messages.
      await thread.runAgent({
        prompt: message.contentParts?.length
          ? message.contentParts
          : message.text,
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

  const runtime = new CopilotRuntime({
    // The Channel supplies its own agent, so no runtime-hosted agents are needed.
    agents: {},
    channels: [channel],
    intelligence: new CopilotKitIntelligence({
      apiKey: required("INTELLIGENCE_API_KEY"),
      ...(process.env.INTELLIGENCE_API_URL
        ? { apiUrl: process.env.INTELLIGENCE_API_URL }
        : {}),
      ...(process.env.INTELLIGENCE_GATEWAY_WS_URL
        ? { wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL }
        : {}),
    }),
  });

  // Teardown is wired before the listener exists, because creating the listener
  // is what activates the Channel — a Ctrl-C during activation must still tear down.
  let stopChannels: (() => Promise<void>) | undefined;
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await stopChannels?.();
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

  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
  });
  stopChannels = () => listener.channels.stop();

  // There is no public provider ingress on this port — Intelligence owns the
  // provider edge — but the server keeps the lifecycle-owning process alive.
  const port = Number(process.env.CHANNEL_PORT ?? 8300);
  createServer(listener).listen(port, () => {
    console.log(`[channel] listener on :${port}`);
  });

  // Bounded, so a wedged connect cannot hang startup forever and a failure exits
  // non-zero instead of looking live. A rejection here (e.g. a Channel in
  // `error`) still falls through to the top-level `.catch` below and exits
  // non-zero.
  await listener.channels.ready({ timeoutMs: 30_000 });

  // `ready()` resolving only means every Channel reached a terminal,
  // non-connecting state — that includes `setup_required`, where nothing is
  // actually attached yet. Report what `status()` says is true, not what we
  // hoped would be true, so an unfinished setup reads as unfinished instead
  // of as success.
  const { channels: channelStatuses } = listener.channels.status();
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
