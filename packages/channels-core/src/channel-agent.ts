import type { AbstractAgent } from "@ag-ui/client";
import type { PlatformAdapter } from "./platform-adapter.js";

/**
 * Channel agent binding + routing contracts (Task 2).
 *
 * A Channel declares WHICH agent it uses; the Runtime supplies named agents and
 * executes the selected one. There are four modes:
 *
 * - `AbstractAgent`  — a fixed inline agent (registered under a private key).
 * - `string`         — a named Runtime agent.
 * - `ChannelAgentRouter` — selects a named Runtime agent per turn.
 * - omitted          — the Runtime agent named `"default"`.
 *
 * The old `(threadId) => AbstractAgent` per-thread factory is REMOVED; the
 * Runtime clones the configured agent per execution and assigns the canonical
 * thread id.
 *
 * NOTE (review assumption A9): `ChannelRouteEvent`'s exact shape is derived from
 * the plan's behavioral description ("bounded discriminated union for messages,
 * commands, interactions, reactions, and thread-start events"); reconcile
 * against the planned artifact before the beta cut.
 */

/** Conversation surface kind, normalized across providers. */
export type ChannelConversationKind =
  | "direct_message"
  | "channel"
  | "thread"
  | "assistant";

/**
 * A bounded, side-effect-free view of the originating provider event handed to
 * an agent router. It MUST NEVER carry raw provider requests/payloads, provider
 * clients, credentials/tokens, HTTP headers or target URLs, file bytes, or
 * unbounded history — only safe, normalized fields.
 */
export type ChannelRouteEvent =
  | {
      readonly kind: "message";
      /** Safe text of the triggering message, if any. */
      readonly text?: string;
      /** True when the bot was explicitly tagged/mentioned. */
      readonly mentioned?: boolean;
    }
  | {
      readonly kind: "command";
      /** Slash-command name, without the leading slash. */
      readonly name: string;
      /** Safe command argument text, if any. */
      readonly args?: string;
    }
  | {
      readonly kind: "interaction";
      /** Action id of the interactive component that fired. */
      readonly actionId: string;
      /** Safe, bounded action value(s). */
      readonly value?: string;
    }
  | {
      readonly kind: "reaction";
      /** Reaction/emoji name, e.g. "eyes". */
      readonly name: string;
    }
  | {
      readonly kind: "thread_start";
    };

/** Safe, bounded identity of the acting end user. */
export interface ChannelRouteUser {
  readonly id: string;
  readonly name?: string;
  readonly handle?: string;
  readonly email?: string;
}

/**
 * The only context an agent router receives. Assembled by a side-effect-free
 * preflight from a bounded provider envelope — never from a raw provider
 * request.
 */
export interface ChannelAgentRouteContext {
  readonly channelName: string;
  readonly platform: string;
  readonly turnId: string;
  readonly conversation: {
    readonly key: string;
    readonly kind: ChannelConversationKind;
  };
  readonly user?: ChannelRouteUser;
  readonly event: ChannelRouteEvent;
  readonly signal: AbortSignal;
}

/**
 * Routes a turn to a NAMED Runtime agent. Must return a name, never an agent
 * object; unknown names fail loudly with no fallback.
 */
export type ChannelAgentRouter = (
  context: ChannelAgentRouteContext,
) => string | Promise<string>;

/**
 * How a Channel selects its agent. See the four modes in the file header.
 */
export type ChannelAgentBinding = AbstractAgent | string | ChannelAgentRouter;

/** The durably-pinned selection for a turn — an opaque namespaced key. */
export interface ChannelAgentSelection {
  readonly key: string;
}

/**
 * What to do when a new turn arrives for a canonical conversation that already
 * has an in-flight turn. Default is `"replace"`.
 */
export type ChannelConcurrencyDecision = "replace" | "queue" | "drop";

/** Per-Channel concurrency policy (currently just the default decision). */
export interface ChannelConcurrencyPolicy {
  readonly onConcurrent?: ChannelConcurrencyDecision;
}

/** Context for a concurrency decision within one canonical conversation. */
export interface ChannelConcurrencyContext {
  readonly channelName: string;
  readonly conversationKey: string;
  readonly turnId: string;
}

/**
 * @internal
 * The Runtime-only surface a {@link Channel} exposes so the Runtime can compile
 * it into a Runtime-executable binding (Task 8). Reached through the
 * `ɵ`-prefixed `Channel.ɵruntime` member; it is EXPORTED but UNDOCUMENTED — not
 * part of the public Channel API (review assumption A6). Additive today; the
 * relocated direct-adapter lifecycle (`start`/`stop`/`addAdapter`) moves here in
 * the Task 3 rewire.
 */
export interface ChannelRuntimeInternals {
  /**
   * The Channel's declared four-mode agent binding, verbatim (inline agent /
   * named / router / omitted). The Runtime resolves named/routed/default
   * bindings against its agent registry; `undefined` means the default agent.
   */
  readonly agentBinding?: ChannelAgentBinding;
  /** The Channel's declared per-conversation concurrency policy, if any. */
  readonly concurrency?: ChannelConcurrencyPolicy;

  /**
   * Attach an adapter before {@link start}. The Channel Runner uses this to
   * bind the declared local adapter. Throws if called after the Channel has
   * started.
   */
  addAdapter(adapter: PlatformAdapter): void;
  /**
   * Resolve persistence/transcripts/actions/telemetry and start every attached
   * adapter. Idempotent. This is the relocated Channel lifecycle (plan §2): the
   * production Channel Runner drives it — the public `Channel.start()` is
   * removed.
   */
  start(): Promise<void>;
  /** Tear down every attached adapter. Mirrors the relocated {@link start}. */
  stop(): Promise<void>;
}
