import type { CopilotKitIntelligence } from "../intelligence-platform";
// Type-only: @copilotkit/channels is pure-ESM, so a value import would break this
// package's CJS output (see `runtime.ts` for the same constraint).
import type { Channel } from "@copilotkit/channels";

/**
 * Error thrown when a Channel activation config cannot be derived — either the
 * Intelligence API key does not carry a project id in the expected
 * `cpk-{projectId}_...` format, or the {@link Channel} is missing a `name`.
 */
export class ChannelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelConfigError";
  }
}

/**
 * Resolved configuration needed to activate a single Channel against a
 * running Intelligence runtime instance.
 */
export interface ChannelActivationConfig {
  /** Intelligence runner websocket URL the Channel connects to. */
  wsUrl: string;
  /** Intelligence API key used to authenticate the runner connection. */
  apiKey: string;
  /** Intelligence app-api HTTP base URL (`intelligence.ɵgetApiUrl()`), forwarded
   * to the transport so the managed realtime path enables file/history parity
   * (those are HTTP-only). Without it, Channels started by the normal runtime
   * handler run with no history and no file support (OSS-476). */
  apiUrl: string;
  /** Project id parsed from {@link apiKey}. */
  projectId: number;
  /** The Channel's declared name (`createChannel({ name })`). */
  channelName: string;
  /**
   * The managed provider this Channel declares to the Intelligence gateway on
   * join, resolved from the Channel's per-Channel `provider` (e.g. `"slack"` or
   * `"teams"`), defaulting to `"slack"`. Named `adapter` because that is the
   * field the gateway's join payload expects; the gateway resolves the actual
   * connection for the declared provider.
   */
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
 * @returns The parsed, strictly-positive, safe-integer project id.
 * @throws {ChannelConfigError} If `apiKey` does not match the expected
 *   `cpk-{projectId}_...` format — a wrong/missing prefix or an absent project
 *   id segment all fail the same match — or if the parsed project id is not a
 *   strictly-positive safe integer.
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
  // A very long digit run also matches `\d+` but loses precision (or overflows
  // to Infinity) once coerced to `Number`, so it must be rejected too even
  // though it is `> 0` — `Number.isSafeInteger` catches both. This is the
  // parser guarding its own contract, not a channel-name replica, so it
  // belongs here. Reuse the same redaction: never echo the key value.
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new ChannelConfigError(
      `Parsed an invalid project id (${projectId}) from the Intelligence API ` +
        `key — the project id in "cpk-{projectId}_..." must be a positive safe ` +
        `integer (the key value is omitted here to avoid leaking secret material).`,
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
 * @param args.channel - The Channel being activated. Must have a `name`; its
 *   per-Channel `provider` selects the managed adapter declared to the gateway.
 * @param args.runtimeInstanceId - Identifier for the activating runtime
 *   instance, passed through unchanged.
 * @returns The resolved {@link ChannelActivationConfig}.
 * @throws {ChannelConfigError} If the Intelligence API key does not carry a
 *   parseable, strictly-positive project id, or if `channel.name` is
 *   missing/empty.
 *
 * The managed provider is a PER-CHANNEL choice read from `channel.ɵruntime.provider`
 * (relocated off the public Channel API, A1), so one runtime can activate a
 * Slack-backed Channel and a Teams-backed Channel side by side. When unset the
 * config adapter defaults to
 * `"slack"` — an explicit, documented default, not a silent global. The SDK
 * only DECLARES this provider to the Intelligence gateway on join; the gateway
 * resolves the actual connection and is the authority on which providers it
 * accepts (it accepts only `"slack"` today — Teams gateway support is tracked
 * in OSS-450).
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
  runtimeInstanceId: string;
}): ChannelActivationConfig {
  const { intelligence, channel, runtimeInstanceId } = args;

  if (!channel.name) {
    throw new ChannelConfigError(
      "Channel is missing a `name` — pass createChannel({ name }) to activate it.",
    );
  }

  const channelName = channel.name;

  const wsUrl = intelligence.ɵgetRunnerWsUrl();
  const apiUrl = intelligence.ɵgetApiUrl();
  const apiKey = intelligence.ɵgetRunnerAuthToken();
  const projectId = parseProjectIdFromApiKey(apiKey);

  // Resolve the managed adapter declared to the gateway from the Channel's OWN
  // `provider` — a per-Channel choice, not a manager-wide default. When
  // `provider` is unset the adapter is the documented default `"slack"`; set
  // `createChannel({ provider: "teams" })` to declare Teams instead. The value
  // is trimmed so a padded runtime value (one that bypassed the typed union)
  // resolves to its bare provider rather than being forwarded with whitespace,
  // and a blank/whitespace-only provider falls back to `"slack"` (`??` alone
  // would keep `""`).
  const trimmedProvider = channel.ɵruntime.provider?.trim();

  return {
    wsUrl,
    apiUrl,
    apiKey,
    projectId,
    channelName,
    adapter: trimmedProvider ? trimmedProvider : "slack",
    runtimeInstanceId,
  };
}
