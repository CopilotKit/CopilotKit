/**
 * The Channel this project declares, and how it answers.
 *
 * Split out from `channel-host.mts` so the host is identical in every starter:
 * this is the only file that knows which agent the project builds. It is also
 * where a Channel is customised — add commands, reactions, or an `onMention`
 * handler here rather than in the host.
 */
import { readFileSync } from "node:fs";
import { createChannel } from "@copilotkit/channels";
import { createDefaultAgent } from "./src/agent";

/**
 * Resolves which declared Channel this process should host.
 *
 * `.copilotkit/channels.json` is written by the CLI and committed, so a fresh
 * clone knows the name with no local state. One declared Channel is the normal
 * case. Several is genuinely ambiguous, so it is an error naming the candidates
 * rather than a guess — hosting the wrong Channel would look like it worked.
 */
export function resolveChannelName(): string {
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

/**
 * Builds the Channel the host holds open.
 *
 * No adapters and no provider tools: the transport is attached by the runtime
 * when the handler activates the Channel, and per-provider tools would make
 * this file provider-specific. `onMessage` (not `onMention`) is what makes the
 * Channel work on 1:1 platforms as well as multi-party ones — a non-mention
 * turn is only ever dispatched to message handlers.
 */
export function createDefaultChannel(channelName: string) {
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

  return channel;
}
