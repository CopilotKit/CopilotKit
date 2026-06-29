import type { Bot } from "../create-bot.js";
import type { StateStore } from "../state/state-store.js";
import type { DeliverySource, EgressSink } from "./transports.js";
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
    if (seen.has(name)) {
      throw new Error(
        `duplicate managed bot name "${name}" — each bot in a runtime must be unique`,
      );
    }
    seen.add(name);
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
}

/**
 * Build the activation metadata declared to Intelligence: the env/versions
 * (supplied by the caller, which knows the real runtime values) plus the
 * declared bot names. Pure.
 *
 * TODO(OSS-377): include per-bot commands/capabilities once the bot exposes them.
 */
export function buildActivationMetadata(
  bots: readonly Bot[],
  env: ActivationEnv,
): ActivationMetadata {
  return {
    ...env,
    declaredBotNames: bots.map((b) => b.name).filter((n): n is string => !!n),
  };
}

/** Per-bot managed transport, resolved by the runtime (closed Gateway/Outbox). */
export interface ManagedTransport {
  source: DeliverySource;
  egress: EgressSink;
  store?: StateStore;
}

export interface StartManagedBotsOptions {
  bots: Bot[];
  /** Resolve the inbound/outbound transport for a declared bot name. */
  resolveTransport: (botName: string) => ManagedTransport;
  env: ActivationEnv;
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
  const metadata = buildActivationMetadata(opts.bots, opts.env);
  for (const bot of opts.bots) {
    const { source, egress, store } = opts.resolveTransport(bot.name!);
    bot.addAdapter(intelligenceAdapter({ source, egress, store }));
    await bot.start();
  }
  return {
    metadata,
    async stop() {
      await Promise.all(opts.bots.map((b) => b.stop()));
    },
  };
}
