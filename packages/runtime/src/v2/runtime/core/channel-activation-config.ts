import type { CopilotKitIntelligence } from "../intelligence-platform";
// Type-only: @copilotkit/channels is pure-ESM, so a value import would break this
// package's CJS output (see `runtime.ts` for the same constraint).
import type { Channel } from "@copilotkit/channels";

/**
 * Error thrown when a Channel activation config cannot be derived — either the
 * Intelligence API key does not carry a project id in the expected
 * `cpk-{projectId}_...` format, or the {@link Channel} is missing a `name`.
 */
export class ChannelConfigError extends Error {}

/**
 * Resolved configuration needed to activate a single Channel against a
 * running Intelligence runtime instance.
 */
export interface ChannelActivationConfig {
  /** Intelligence runner websocket URL the Channel connects to. */
  wsUrl: string;
  /** Intelligence API key used to authenticate the runner connection. */
  apiKey: string;
  /** Project id parsed from {@link apiKey}. */
  projectId: number;
  /** The Channel's declared name (`createChannel({ name })`). */
  channelName: string;
  /** Delivery adapter this Channel activation targets, e.g. `"slack"`. */
  adapter: string;
  /** Identifier for the runtime instance activating this Channel. */
  runtimeInstanceId: string;
}

/** Matches the `cpk-{projectId}_...` Intelligence API key format. */
const API_KEY_PROJECT_ID_PATTERN = /^cpk-(\d+)_/;

/**
 * Parse the project id embedded in an Intelligence API key.
 *
 * Intelligence API keys are formatted `cpk-{projectId}_{rest}` — this
 * extracts and numerically parses the `{projectId}` segment.
 *
 * @param apiKey - The Intelligence API key to parse.
 * @returns The parsed project id.
 * @throws {ChannelConfigError} If `apiKey` does not match the expected
 *   `cpk-{projectId}_...` format (wrong prefix, or an empty project id
 *   segment).
 */
export function parseProjectIdFromApiKey(apiKey: string): number {
  const match = API_KEY_PROJECT_ID_PATTERN.exec(apiKey);
  if (!match) {
    throw new ChannelConfigError(
      `Could not parse a project id from the Intelligence API key — expected the ` +
        `"cpk-{projectId}_..." format, got: "${apiKey}"`,
    );
  }
  return Number(match[1]);
}

/**
 * Derive the {@link ChannelActivationConfig} needed to activate `channel`
 * against the given Intelligence runtime configuration.
 *
 * @param args.intelligence - The Intelligence runtime client to pull the
 *   runner websocket URL and auth token from.
 * @param args.channel - The Channel being activated. Must have a `name`.
 * @param args.adapter - Delivery adapter name. Defaults to `"slack"`.
 * @param args.runtimeInstanceId - Identifier for the activating runtime
 *   instance, passed through unchanged.
 * @returns The resolved {@link ChannelActivationConfig}.
 * @throws {ChannelConfigError} If the Intelligence API key does not carry a
 *   parseable project id, or if `channel.name` is missing/empty.
 */
export function deriveChannelActivationConfig(args: {
  intelligence: CopilotKitIntelligence;
  channel: Channel;
  adapter?: string;
  runtimeInstanceId: string;
}): ChannelActivationConfig {
  const { intelligence, channel, adapter, runtimeInstanceId } = args;

  if (!channel.name) {
    throw new ChannelConfigError(
      "Channel is missing a `name` — pass createChannel({ name }) to activate it.",
    );
  }

  const wsUrl = intelligence.ɵgetRunnerWsUrl();
  const apiKey = intelligence.ɵgetRunnerAuthToken();
  const projectId = parseProjectIdFromApiKey(apiKey);

  return {
    wsUrl,
    apiKey,
    projectId,
    channelName: channel.name,
    adapter: adapter ?? "slack",
    runtimeInstanceId,
  };
}
