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
 * Lowercase kebab-case Channel-name rule, replicated from
 * `assertValidChannelRealtimeScope` in `@copilotkit/channels-intelligence`
 * (`realtime-gateway-transport.ts`), which remains the SOURCE OF TRUTH. It is
 * enforced up front here — before any engine call — so a malformed name fails
 * loud with a clear {@link ChannelConfigError} instead of throwing deep inside
 * the launcher and being silently degraded to `error` status. Kept as a literal
 * copy (NOT a static import) because channels-intelligence is a pure-ESM
 * optional peer this CJS package must not statically depend on.
 */
const CHANNEL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Minimum Channel-name length (source of truth: `assertValidChannelRealtimeScope`). */
const CHANNEL_NAME_MIN_LENGTH = 3;
/** Maximum Channel-name length (source of truth: `assertValidChannelRealtimeScope`). */
const CHANNEL_NAME_MAX_LENGTH = 64;

/**
 * Parse the project id embedded in an Intelligence API key.
 *
 * Intelligence API keys are formatted `cpk-{projectId}_{rest}` — this
 * extracts and numerically parses the `{projectId}` segment.
 *
 * @param apiKey - The Intelligence API key to parse.
 * @returns The parsed project id.
 * @throws {ChannelConfigError} If `apiKey` does not match the expected
 *   `cpk-{projectId}_...` format — a wrong/missing prefix or an absent project
 *   id segment all fail the same match.
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
 *   parseable project id, if `channel.name` is missing/empty, or if
 *   `channel.name` is not lowercase kebab-case within the 3–64 char bounds
 *   required by the Realtime Gateway launcher (see {@link CHANNEL_NAME_PATTERN}).
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
  // Enforce the launcher's channel-name contract UP FRONT (see
  // CHANNEL_NAME_PATTERN). A name like "Slack", "support_bot", or "cs" passes
  // the manager's non-empty/unique check but would otherwise throw deep in the
  // Realtime Gateway launcher and be silently degraded to `error` status. Fail
  // loud here with a clear, actionable message instead.
  if (
    channelName.length < CHANNEL_NAME_MIN_LENGTH ||
    channelName.length > CHANNEL_NAME_MAX_LENGTH ||
    !CHANNEL_NAME_PATTERN.test(channelName)
  ) {
    throw new ChannelConfigError(
      `Managed Channel name "${channelName}" is invalid — a Channel name must be ` +
        `lowercase kebab-case (matching ${String(CHANNEL_NAME_PATTERN)}) and ` +
        `${CHANNEL_NAME_MIN_LENGTH}–${CHANNEL_NAME_MAX_LENGTH} characters long. ` +
        `Rename it via createChannel({ name }).`,
    );
  }

  const wsUrl = intelligence.ɵgetRunnerWsUrl();
  const apiKey = intelligence.ɵgetRunnerAuthToken();
  const projectId = parseProjectIdFromApiKey(apiKey);

  return {
    wsUrl,
    apiKey,
    projectId,
    channelName,
    adapter: adapter ?? "slack",
    runtimeInstanceId,
  };
}
