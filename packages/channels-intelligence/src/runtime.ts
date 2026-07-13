import type { Channel, StateStore } from "@copilotkit/channels";
import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
} from "./transports.js";
import { intelligenceAdapter } from "./intelligence-adapter.js";

/** Lowercase kebab-case Channel name, 3–64 characters. */
const CHANNEL_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RESERVED_CHANNEL_NAME = "channels";

/**
 * Validate the framework Channels declared to a Channel runtime: each needs a
 * `name`, names must be lowercase kebab-case Channel names, and they must be
 * unique within the runtime. Fails
 * loudly — a misconfigured declaration should never start silently.
 */
export function assertValidChannelNames(channels: readonly Channel[]): void {
  const seen = new Set<string>();
  for (const channel of channels) {
    const name = channel.name;
    if (!name) {
      throw new Error(
        "Intelligence Channel is missing a `name` — pass createChannel({ name }) for an Intelligence Channel",
      );
    }
    if (name.length < 3 || name.length > 64 || !CHANNEL_NAME_RE.test(name)) {
      throw new Error(
        `Channel name "${name}" is invalid — use lowercase kebab-case, 3–64 characters`,
      );
    }
    if (name === RESERVED_CHANNEL_NAME) {
      throw new Error(`Channel name "${name}" is reserved`);
    }
    if (seen.has(name)) {
      throw new Error(
        `duplicate Channel name "${name}" — each Channel runtime entry must be unique`,
      );
    }
    seen.add(name);
  }
}

/** Runtime environment + version metadata sent to Intelligence on activation. */
export interface ChannelActivationEnv {
  runtimeInstanceId?: string;
  /** COPILOTKIT_RUNTIME_ENV override, else NODE_ENV, else "development". */
  runtimeEnv: string;
  nodeEnv?: string;
  nodeVersion?: string;
  runtimePackageVersion?: string;
  channelsPackageVersion?: string;
}

export interface ChannelActivationMetadata extends ChannelActivationEnv {
  declaredChannelNames: string[];
  /** Per-Channel declarations: name + declared slash-command names. */
  declaredChannels: Array<{ channelName: string; commands: string[] }>;
}

/**
 * Gather the process-level runtime activation env — `COPILOTKIT_RUNTIME_ENV`
 * (override) → `NODE_ENV` → "development", and the Node version. Caller
 * `overrides` win and supply what only the runtime knows: package versions
 * (`runtimePackageVersion`/`channelsPackageVersion`) and a stable `runtimeInstanceId`.
 */
export function resolveChannelActivationEnv(
  overrides: Partial<ChannelActivationEnv> = {},
): ChannelActivationEnv {
  // Guard against non-Node hosts (browser/edge) where `process` is absent.
  const env = typeof process !== "undefined" ? process.env : undefined;
  const nodeEnv = env?.NODE_ENV;
  return {
    runtimeEnv: env?.COPILOTKIT_RUNTIME_ENV ?? nodeEnv ?? "development",
    nodeEnv,
    nodeVersion: typeof process !== "undefined" ? process.version : undefined,
    ...overrides,
  };
}

/**
 * Build the activation metadata declared to Intelligence: the resolved
 * env/versions plus per-Channel declarations (name + declared command names). Pure.
 *
 * Assumes every Channel has a name — call {@link assertValidChannelNames} first
 * (`startChannels` does). A nameless Channel is a programming error and throws
 * rather than being silently filtered out of the activation set.
 *
 * TODO(OSS-377): add richer per-Channel capabilities once the framework Channel exposes them.
 */
export function buildChannelActivationMetadata(
  channels: readonly Channel[],
  env: ChannelActivationEnv,
): ChannelActivationMetadata {
  const names = channels.map((c) => {
    if (!c.name) {
      throw new Error(
        "buildChannelActivationMetadata: Channel is missing a `name` — validate with assertValidChannelNames first",
      );
    }
    return c.name;
  });
  return {
    ...env,
    declaredChannelNames: names,
    declaredChannels: channels.map((c, i) => ({
      channelName: names[i]!,
      commands: c.commandNames,
    })),
  };
}

/** Per-Channel transport, resolved by the runtime (closed Gateway/Outbox). */
export interface ChannelTransport {
  source: DeliverySource;
  egress: EgressSink;
  renderSink?: RenderEventSink;
  store?: StateStore;
}

export interface StartChannelsOptions {
  channels: Channel[];
  /** Resolve the inbound/outbound transport for a declared Channel name. */
  resolveTransport: (channelName: string) => ChannelTransport;
  /** Activation env overrides; omitted fields are gathered from the process. */
  env?: Partial<ChannelActivationEnv>;
}

export interface ChannelsHandle {
  metadata: ChannelActivationMetadata;
  stop(): Promise<void>;
}

/**
 * Start the Channel listener lifecycle: validate the declared framework Channels,
 * build the activation metadata, then attach an `intelligenceAdapter` to each Channel (wired
 * to its resolved transport) and start it. Returns the metadata and a `stop`.
 *
 * The transports come from the caller (production: the Realtime Gateway +
 * Connector Outbox clients; tests: in-memory). This module owns no Slack
 * credentials, webhook ingress, or outbox persistence.
 */
export async function startChannels(
  opts: StartChannelsOptions,
): Promise<ChannelsHandle> {
  assertValidChannelNames(opts.channels);
  if (opts.channels.length === 0) {
    console.warn(
      "[channels-intelligence] startChannels called with no channels — nothing to start. " +
        "Pass `channels: [createChannel({ name })]` on the Intelligence runtime.",
    );
  }
  const metadata = buildChannelActivationMetadata(
    opts.channels,
    resolveChannelActivationEnv(opts.env),
  );
  // Partial-start rollback: addAdapter/resolveTransport/start for channel N can
  // throw AFTER Channels 0..N-1 are already live. Without unwinding, those
  // started Channels leak (open listeners/connections) with no handle to stop
  // them. Track what started and stop it before rethrowing.
  const startedChannels: Channel[] = [];
  try {
    for (const channel of opts.channels) {
      const { source, egress, renderSink, store } = opts.resolveTransport(
        channel.name!,
      );
      channel.addAdapter(
        intelligenceAdapter({ source, egress, renderSink, store }),
      );
      await channel.start();
      startedChannels.push(channel);
    }
  } catch (err) {
    await Promise.allSettled(startedChannels.map((c) => c.stop()));
    throw err;
  }
  return {
    metadata,
    async stop() {
      await Promise.all(opts.channels.map((c) => c.stop()));
    },
  };
}
