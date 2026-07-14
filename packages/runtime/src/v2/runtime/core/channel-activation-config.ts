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
 * @returns The parsed, strictly-positive project id.
 * @throws {ChannelConfigError} If `apiKey` does not match the expected
 *   `cpk-{projectId}_...` format — a wrong/missing prefix or an absent project
 *   id segment all fail the same match — or if the parsed project id is not
 *   strictly positive.
 */
export function parseProjectIdFromApiKey(apiKey: string): number {
  const match = API_KEY_PROJECT_ID_PATTERN.exec(apiKey);
  if (!match) {
    // The whole API key is a `cpk-…` secret — everything after the fixed `cpk-`
    // namespace is sensitive, so a fixed-width slice (e.g. `apiKey.slice(0, 8)`)
    // would echo secret bytes for a `cpk-_short_long`-shaped key. This message is
    // logged and surfaced through `ready()`'s AggregateError, so echo NONE of the
    // key value; name only the expected format to aid diagnosis.
    throw new ChannelConfigError(
      `Could not parse a project id from the Intelligence API key — expected the ` +
        `"cpk-{projectId}_..." format (the key value is omitted here to avoid ` +
        `leaking secret material).`,
    );
  }
  const projectId = Number(match[1]);
  // Validate the parser's OWN output: `cpk-0_...` matches the pattern but a
  // non-positive project id would otherwise fail deep inside the launcher's
  // `assertValidChannelRealtimeScope` (which requires a positive projectId).
  // This is the parser guarding its own contract, not a channel-name replica, so
  // it belongs here. Reuse the same redaction: never echo the key value.
  if (projectId <= 0) {
    throw new ChannelConfigError(
      `Parsed a non-positive project id (${projectId}) from the Intelligence API ` +
        `key — the project id in "cpk-{projectId}_..." must be a positive integer ` +
        `(the key value is omitted here to avoid leaking secret material).`,
    );
  }
  return projectId;
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
 *   parseable, strictly-positive project id, or if `channel.name` is
 *   missing/empty.
 *
 * The Channel-name FORMAT rules (lowercase kebab-case, 3–64 chars) and the
 * reserved-name rule are NOT re-checked here. Their single source of truth is
 * the `@copilotkit/channels-intelligence` launcher
 * (`assertValidChannelRealtimeScope` + `assertValidChannelNames`), which
 * validates them at activation; a malformed name surfaces as a logged `error`
 * status via {@link ChannelManager.ready} rather than an up-front throw. An
 * empty/missing name is still rejected here because that is this config's own
 * precondition (it has no name to forward at all), not a downstream replica.
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

  const channelName = channel.name;

  const wsUrl = intelligence.ɵgetRunnerWsUrl();
  const apiKey = intelligence.ɵgetRunnerAuthToken();
  const projectId = parseProjectIdFromApiKey(apiKey);

  return {
    wsUrl,
    apiKey,
    projectId,
    channelName,
    // Fall back to "slack" for an absent, empty, or whitespace-only adapter
    // (`??` alone would keep `""`); a blank adapter is not a meaningful target.
    adapter: adapter && adapter.trim() ? adapter : "slack",
    runtimeInstanceId,
  };
}
