import type { Bot, StateStore } from "@copilotkit/channels";
import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
} from "./transports.js";
import { intelligenceAdapter } from "./intelligence-adapter.js";

/** Project/code identifier: starts with a letter, then letters/digits/underscore. */
const BOT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Validate the bots declared to a managed runtime: each needs a `name`, names
 * must be identifier-style, and they must be unique within the runtime. Fails
 * loudly — a misconfigured declaration should never start silently.
 */
export function assertValidBotNames(bots: readonly Bot[]): void {
  const seen = new Set<string>();
  for (const bot of bots) {
    const name = bot.name;
    if (!name) {
      throw new Error(
        "managed bot is missing a `name` — pass createBot({ name }) for Intelligence-delivered bots",
      );
    }
    if (!BOT_NAME_RE.test(name)) {
      throw new Error(
        `managed bot name "${name}" is invalid — use a project/code identifier ` +
          "(letters, digits, underscore; starting with a letter)",
      );
    }
    // Case-insensitive uniqueness: "Support" and "support" would resolve to the
    // same delivery routing, so reject the collision rather than let both bots
    // receive every delivery.
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new Error(
        `duplicate managed bot name "${name}" — each bot in a runtime must be unique (case-insensitive)`,
      );
    }
    seen.add(key);
  }
}

/** Runtime environment + version metadata sent to Intelligence on activation. */
export interface ActivationEnv {
  runtimeInstanceId?: string;
  /** COPILOTKIT_RUNTIME_ENV override, else NODE_ENV, else "development". */
  runtimeEnv: string;
  nodeEnv?: string;
  nodeVersion?: string;
  runtimePackageVersion?: string;
  botPackageVersion?: string;
}

export interface ActivationMetadata extends ActivationEnv {
  declaredBotNames: string[];
  /** Per-bot declarations: name + declared slash-command names. */
  declaredBots: Array<{ name: string; commands: string[] }>;
}

/**
 * Gather the process-level runtime activation env — `COPILOTKIT_RUNTIME_ENV`
 * (override) → `NODE_ENV` → "development", and the Node version. Caller
 * `overrides` win and supply what only the runtime knows: package versions
 * (`runtimePackageVersion`/`botPackageVersion`) and a stable `runtimeInstanceId`.
 */
export function resolveActivationEnv(
  overrides: Partial<ActivationEnv> = {},
): ActivationEnv {
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
 * env/versions plus per-bot declarations (name + declared command names). Pure.
 *
 * Assumes every bot has a name — call {@link assertValidBotNames} first
 * (`startManagedBots` does). A nameless bot is a programming error and throws
 * rather than being silently filtered out of the activation set.
 *
 * TODO(OSS-377): add richer per-bot capabilities once the bot exposes them.
 */
export function buildActivationMetadata(
  bots: readonly Bot[],
  env: ActivationEnv,
): ActivationMetadata {
  const names = bots.map((b) => {
    if (!b.name) {
      throw new Error(
        "buildActivationMetadata: bot is missing a `name` — validate with assertValidBotNames first",
      );
    }
    return b.name;
  });
  return {
    ...env,
    declaredBotNames: names,
    declaredBots: bots.map((b, i) => ({
      name: names[i]!,
      commands: b.commandNames,
    })),
  };
}

/** Per-bot managed transport, resolved by the runtime (closed Gateway/Outbox). */
export interface ManagedTransport {
  source: DeliverySource;
  egress: EgressSink;
  renderSink?: RenderEventSink;
  store?: StateStore;
}

export interface StartManagedBotsOptions {
  bots: Bot[];
  /** Resolve the inbound/outbound transport for a declared bot name. */
  resolveTransport: (botName: string) => ManagedTransport;
  /** Activation env overrides; omitted fields are gathered from the process. */
  env?: Partial<ActivationEnv>;
}

export interface ManagedBotsHandle {
  metadata: ActivationMetadata;
  stop(): Promise<void>;
}

/**
 * Start the managed listener lifecycle: validate the declared bots, build the
 * activation metadata, then attach an `intelligenceAdapter` to each bot (wired
 * to its resolved transport) and start it. Returns the metadata and a `stop`.
 *
 * The transports come from the caller (production: the Realtime Gateway +
 * Connector Outbox clients; tests: in-memory). This module owns no Slack
 * credentials, webhook ingress, or outbox persistence.
 */
export async function startManagedBots(
  opts: StartManagedBotsOptions,
): Promise<ManagedBotsHandle> {
  assertValidBotNames(opts.bots);
  if (opts.bots.length === 0) {
    console.warn(
      "[bot-intelligence] startManagedBots called with no bots — nothing to start. " +
        "Pass `bots: [createBot({ name })]` on the Intelligence runtime.",
    );
  }
  const metadata = buildActivationMetadata(
    opts.bots,
    resolveActivationEnv(opts.env),
  );
  // Partial-start rollback: addAdapter/resolveTransport/start for bot N can
  // throw AFTER bots 0..N-1 are already live. Without unwinding, those started
  // bots leak (open listeners/connections) with no handle to stop them. Track
  // what started and stop it before rethrowing.
  const startedBots: Bot[] = [];
  try {
    for (const bot of opts.bots) {
      const { source, egress, renderSink, store } = opts.resolveTransport(
        bot.name!,
      );
      bot.addAdapter(
        intelligenceAdapter({ source, egress, renderSink, store }),
      );
      await bot.start();
      startedBots.push(bot);
    }
  } catch (err) {
    await Promise.allSettled(startedBots.map((b) => b.stop()));
    throw err;
  }
  return {
    metadata,
    async stop() {
      await Promise.all(opts.bots.map((b) => b.stop()));
    },
  };
}
