import type { Channel } from "@copilotkit/channels-core";

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
  declaredChannels: Array<{
    channelName: string;
    commands: string[];
    tasks?: true;
  }>;
}

/**
 * Gather the process-level runtime activation env — `COPILOTKIT_RUNTIME_ENV`
 * (override) → `NODE_ENV` → "development", and the Node version. Caller
 * `overrides` win and supply what only the runtime knows: package versions
 * (`runtimePackageVersion`/`channelsPackageVersion`) and an activation-scoped
 * `runtimeInstanceId` that is stable only across transport reconnects.
 */
export function resolveChannelActivationEnv(
  overrides: Partial<ChannelActivationEnv> = {},
): ChannelActivationEnv {
  // Guard against non-Node hosts (browser/edge) where `process` is absent.
  const env = typeof process !== "undefined" ? process.env : undefined;
  const copilotRuntimeEnv = env?.COPILOTKIT_RUNTIME_ENV?.trim() || undefined;
  const nodeEnv = env?.NODE_ENV?.trim() || undefined;
  // Only defined overrides may clobber defaults (Partial can carry explicit undefined).
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<ChannelActivationEnv>;
  return {
    runtimeEnv: copilotRuntimeEnv ?? nodeEnv ?? "development",
    nodeEnv,
    nodeVersion: typeof process !== "undefined" ? process.version : undefined,
    ...definedOverrides,
  };
}

/**
 * Build the activation metadata declared to Intelligence: the resolved
 * env/versions plus per-Channel declarations (name + declared command names). Pure.
 *
 * Assumes every Channel has a name — call {@link assertValidChannelNames} first
 * (the managed launcher does). A nameless Channel is a programming error and throws
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
      ...(c.tasksEnabled ? { tasks: true as const } : {}),
    })),
  };
}

export interface ChannelsHandle {
  metadata: ChannelActivationMetadata;
  stop(): Promise<void>;
  /**
   * Optional drop breadcrumb when the managed session disconnects
   * unexpectedly. Not used by `ChannelManager` for reconnect (Phoenix owns
   * reconnect; status is driven by `onStateChange`). Not fired by the
   * handle's own `stop()`. Present when the underlying session supports it
   * (see `ConnectedRealtimeGatewaySession.onClose` in `realtime-gateway.ts`).
   */
  onClose?(cb: () => void): void;
  /**
   * Optional seam: register a connection-health observer so a supervising
   * `ChannelManager`'s `status()` can reflect real connection health
   * (`online` → sendable, `reconnecting` → dropped and retrying, `gave_up` →
   * dead after the bounded reconnect window). Not fired by the handle's own
   * `stop()`. Present when the underlying session supports it (see
   * `ConnectedRealtimeGatewaySession.onStateChange` in `realtime-gateway.ts`).
   */
  onStateChange?(
    cb: (
      state: "online" | "reconnecting" | "gave_up",
      detail?: { reason?: string; code?: string },
    ) => void,
  ): void;
  /**
   * Optional seam: managed provider attachment state per declared Channel, as
   * reported on the newest gateway control join reply — so a supervising
   * `ChannelManager` can tell "the control socket is up" from "a Slack/Teams app
   * is actually bound to this Channel".
   *
   * A getter, not a snapshot: the gateway's join hooks re-fire on every Phoenix
   * auto-rejoin, so a Channel provisioned while the runtime was disconnected is
   * reflected on the next read.
   *
   * `undefined` means "not reported", NOT "no provider attached" — a gateway
   * predating this contract and one whose lookup failed both omit it. Present
   * when the underlying session supports it (see
   * `ConnectedRealtimeGatewaySession.providerStates` in `realtime-gateway.ts`).
   */
  providerStates?(): Readonly<Record<string, string>> | undefined;
}
