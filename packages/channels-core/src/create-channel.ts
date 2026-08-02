import type {
  PlatformAdapter,
  IngressSink,
  IncomingTurn,
  InteractionEvent,
  IncomingCommand,
  IncomingThreadStart,
  IncomingWelcome,
  IncomingReaction,
  IncomingModalSubmit,
  IncomingModalClose,
  ModalSubmitResult,
} from "./platform-adapter.js";
import { ActionRegistry, ActionExpiredError } from "./action-registry.js";
import type { ActionStore } from "./action-store.js";
import { MemoryStore } from "./state/memory-store.js";
import { kvActionStore } from "./state/kv-action-store.js";
import type { StateStore } from "./state/state-store.js";
import { toAgentToolDescriptors, parseToolArgs } from "./tools.js";
import type { ChannelTool, ContextEntry } from "./tools.js";
import { normalizeCommandName, toCommandSpec } from "./commands.js";
import type { ChannelCommand, CommandContext } from "./commands.js";
import { Thread } from "./thread.js";
import type { ThreadDeps } from "./thread.js";
import type { AbstractAgent } from "@ag-ui/client";
import { sanitizeAgentEventStream } from "./sanitize-agent-events.js";
import type {
  ChannelMessage,
  InteractionContext,
  IncomingMessage,
  ProviderActor,
  ApplicationUser,
  EmojiValue,
  EmojiPlatform,
  ModalView,
  ComponentFn,
  MessageRef,
} from "@copilotkit/channels-ui";
import {
  normalizeEmoji,
  toCanonicalEmoji,
  renderToIR,
  resolveComponentName,
} from "@copilotkit/channels-ui";
import { Transcripts } from "./transcripts.js";
import type { TranscriptsConfig } from "./transcripts.js";
import { resolveChannelUser } from "./identity.js";
import type {
  ChannelIdentifyUser,
  ChannelIdentityContext,
} from "./identity.js";
import type { StandardSchemaV1, InferSchemaOutput } from "./standard-schema.js";
import { ChannelTelemetry } from "./telemetry/channel-telemetry.js";
import { errorClass, normalizePlatform } from "./telemetry/sanitize-error.js";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as {
  name: string;
  version: string;
};

const ADAPTER_ROLLBACK_TIMEOUT_MS = 5_000;

function storeKind(s: StateStore): "memory" | "postgres" | "redis" | "custom" {
  const n = s.constructor?.name;
  if (n === "MemoryStore") return "memory";
  if (n === "PostgresStore") return "postgres";
  if (n === "RedisStore") return "redis";
  return "custom";
}

/** Platforms whose tokens the emoji table can normalize. */
const EMOJI_PLATFORMS: ReadonlySet<EmojiPlatform> = new Set([
  "slack",
  "discord",
  "telegram",
  "teams",
  "whatsapp",
]);
function isEmojiPlatform(platform: string): platform is EmojiPlatform {
  return EMOJI_PLATFORMS.has(platform as EmojiPlatform);
}

export type LockConflictDecision = "drop" | "force";

/**
 * How overlapping turns on the same `conversationKey` are handled.
 *
 * - `"parallel"` (default) — concurrent turns run together (no exclusive turn lock).
 * - `"serial"` — later turns wait for the in-flight turn on that conversation to finish.
 * - `"drop"` — later turns are discarded while a turn is in flight.
 */
export type ChannelConcurrency = "parallel" | "serial" | "drop";

/**
 * Isolate an agent for one turn via `clone()`.
 *
 * Applied to every configured shape, so the object a turn runs on is never one
 * the caller still holds a reference to:
 * - `createChannel({ agent: shared })` — singleton config
 * - `agent: (id) => new Agent()` — fresh factory, cloning an unused agent
 * - `agent: (id) => shared` — factory returning the same object every call
 *
 * The last shape is the one that needs this, and it is easy to write by accident
 * (it is also what a singleton becomes when someone refactors to get at the
 * `threadId`). Sharing one `AbstractAgent` across turns is not safe, because
 * turn concurrency defaults to `"parallel"` — see {@link ChannelConcurrency} —
 * and only the managed adapter serializes same-thread deliveries. On a directly
 * connected adapter two turns in one conversation can run at the same time, and
 * on the same instance they corrupt each other: `messages` is a single array
 * both runs append into, so each run's new-message diff picks up the other's,
 * and `isRunning` / `activeRunDetach$` / `activeRunCompletionPromise` are
 * single-slot fields the second run overwrites while the first is still
 * streaming. Managed delivery serializes them instead, on object identity, which
 * head-of-line blocks two *different* conversations that share one instance.
 *
 * Fails loud on all three ways cloning can fail to isolate: a missing `clone()`,
 * a `clone()` that hands back the same object, and a `clone()` that silently
 * drops subclass state (see {@link assertCloneKeptOwnFields}).
 */
export function isolateAgentInstance(
  prototype: AbstractAgent,
  threadId: string,
): AbstractAgent {
  if (typeof prototype.clone !== "function") {
    throw new Error(
      "createChannel: agent must implement clone() that returns a new instance " +
        "(HttpAgent, BuiltInAgent, etc.). Every turn is isolated via clone(), " +
        "including agents returned from an agent: (threadId) => ... factory.",
    );
  }
  const cloned = prototype.clone() as AbstractAgent;
  if (cloned == null || cloned === prototype) {
    throw new Error(
      "createChannel: agent.clone() must return a distinct instance for concurrent turns",
    );
  }
  assertCloneKeptOwnFields(prototype, cloned);
  cloned.threadId = threadId;
  // `clone()` copies `isRunning` from the source, and a source that has already
  // run can be mid-run at the moment it is cloned. A fresh turn is not.
  //
  // Hygiene, not a fix for a dead turn: `runAgent` assigns
  // `abortController = params?.abortController ?? new AbortController()` before
  // each run and the run loop passes no controller, so an inherited aborted
  // controller cannot reach the next request on its own. Reset it anyway so
  // anything reading the signal between isolation and the run sees a live one.
  // Note this deliberately discards `HttpAgent.clone()`'s propagation of the
  // source's aborted state, which exists for callers that clone mid-run.
  cloned.isRunning = false;
  const withAbort = cloned as AbstractAgent & {
    abortController?: AbortController;
  };
  if ("abortController" in withAbort) {
    withAbort.abortController = new AbortController();
  }
  return cloned;
}

/**
 * Fail loud when `clone()` silently drops subclass state.
 *
 * `AbstractAgent.prototype.clone()` copies a fixed field list, so a subclass
 * that declares its own fields (an auth client, config, a cache) gets them back
 * as `undefined` on the clone — and because the base implementation always
 * exists and returns a correctly-typed instance, nothing else surfaces it. The
 * agent just runs gutted.
 *
 * Comparing own enumerable keys catches exactly that and stays quiet for the
 * agents that do override `clone()` (`HttpAgent`, `LangGraphAgent`,
 * `BuiltInAgent`, `IntelligenceAgent`). Symbol-keyed and non-enumerable fields
 * are not covered.
 *
 * Own *functions* are deliberately exempt. Assigning a method on the instance is
 * how spies and instrumentation wrap an agent, and losing that wrapper leaves
 * the class's prototype method intact — the clone still behaves correctly, it
 * just isn't wrapped. Only dropped state leaves an agent genuinely gutted.
 */
function assertCloneKeptOwnFields(
  prototype: AbstractAgent,
  cloned: AbstractAgent,
): void {
  const source = prototype as unknown as Record<string, unknown>;
  const dropped = Object.keys(prototype).filter(
    (key) =>
      typeof source[key] !== "function" &&
      !Object.prototype.hasOwnProperty.call(cloned, key),
  );
  if (dropped.length === 0) return;
  const name = prototype.constructor?.name ?? "the configured agent";
  throw new Error(
    `createChannel: ${name}.clone() dropped ${dropped.join(", ")}. ` +
      "Every turn runs on a clone, and AbstractAgent's clone() only copies its " +
      `own fixed field list, so those fields would read as undefined. Override ` +
      `clone() on ${name} to copy them (HttpAgent.clone() is the reference).`,
  );
}

/**
 * Resolve effective turn concurrency from `store.concurrency` and legacy
 * `store.onLockConflict`. Prefer `concurrency` when both are set.
 */
export function resolveChannelConcurrency(cfg: {
  concurrency?: ChannelConcurrency;
  onLockConflict?:
    | LockConflictDecision
    | ((
        conversationKey: string,
        message: IncomingMessage,
      ) => LockConflictDecision | Promise<LockConflictDecision>);
}): ChannelConcurrency | "legacy-callback" {
  if (cfg.concurrency) return cfg.concurrency;
  if (typeof cfg.onLockConflict === "function") return "legacy-callback";
  if (cfg.onLockConflict === "drop") return "drop";
  if (cfg.onLockConflict === "force") return "parallel";
  return "parallel";
}

/**
 * Any `@copilotkit/channels-ui` component function, regardless of its props type.
 * Accepting `(props: never)` lets a component with required, strongly-typed
 * props (e.g. `({ title }: { title: string }) => …`) be passed to
 * `createChannel({ components })` without a cast — the registry only ever calls it
 * with the props persisted in the store, so the specific shape isn't needed here.
 */
export type ChannelComponent = (props: never) => ReturnType<ComponentFn>;

export type ChannelHandler<TState = unknown> = (ctx: {
  thread: StatefulThread<TState>;
  message: ChannelMessage;
}) => void | Promise<void>;

/** Handler for a "conversation opened" lifecycle event (e.g. the Slack assistant pane). */
export type ThreadStartHandler<TState = unknown> = (ctx: {
  thread: StatefulThread<TState>;
  user: ApplicationUser | null;
  actor: ProviderActor;
}) => void | Promise<void>;

/** Handler for a provider installation or conversation activation. */
export type WelcomeHandler<TState = unknown> = (ctx: {
  thread: StatefulThread<TState>;
  user: ApplicationUser | null;
  actor: ProviderActor;
  platform: string;
}) => void | Promise<void>;

/** Event passed to an `onReaction` handler. */
export interface ReactionEvent {
  /** Normalized name when recognized, else the raw platform token. */
  emoji: EmojiValue;
  /** Platform-native token. */
  rawEmoji: string;
  /** true = added, false = removed. */
  added: boolean;
  /** The reacting user, when the platform reports one. */
  user: ApplicationUser | null;
  actor: ProviderActor;
  messageId: string;
  /** Update-capable ref to the reacted message (`thread.update(messageRef, ui)`). */
  messageRef: MessageRef;
  threadId?: string;
  thread: Thread;
  adapter: PlatformAdapter;
  raw: unknown;
}
export type ReactionHandler = (evt: ReactionEvent) => void | Promise<void>;

/** Event passed to an `onModalSubmit` handler. */
export interface ModalSubmitEvent {
  callbackId: string;
  values: Record<string, unknown>;
  user: ApplicationUser | null;
  actor: ProviderActor;
  /** Present when the submission carried a conversation context. */
  thread?: Thread;
  privateMetadata?: string;
  raw: unknown;
}
export type ModalSubmitHandler = (
  evt: ModalSubmitEvent,
) => ModalSubmitResult | void | Promise<ModalSubmitResult | void>;

/** Event passed to an `onModalClose` handler. */
export interface ModalCloseEvent {
  callbackId: string;
  user: ApplicationUser | null;
  actor: ProviderActor;
  privateMetadata?: string;
  raw: unknown;
}
export type ModalCloseHandler = (evt: ModalCloseEvent) => void | Promise<void>;

/** The per-thread state type implied by the configured `store.state` schema. */
type ThreadStateOf<TSchema extends StandardSchemaV1 | undefined> =
  TSchema extends StandardSchemaV1 ? InferSchemaOutput<TSchema> : unknown;

/** A Thread whose state()/setState() are narrowed to the configured state type. */
export type StatefulThread<TState> = Omit<Thread, "setState" | "state"> & {
  setState(value: TState): Promise<void>;
  state(): Promise<TState | undefined>;
};

/**
 * Persistence and per-thread state configuration. Groups the pluggable
 * backend, optional state schema, transcript storage, and turn-lock/dedup
 * tuning under a single `store` option.
 */
export interface StoreConfig<
  TStateSchema extends StandardSchemaV1 | undefined = undefined,
> {
  /** Pluggable persistence backend. Defaults to in-memory MemoryStore (lost on restart). */
  adapter?: StateStore;
  /** Standard Schema for per-thread state. When set, thread.state()/setState() are typed to its output and setState validates at runtime. */
  state?: TStateSchema;
  /** Cross-platform transcript storage keyed by the identified application user. */
  transcripts?: TranscriptsConfig;
  /**
   * How overlapping turns on the same conversationKey are handled.
   * Default: `"parallel"`. Prefer this over {@link onLockConflict}.
   */
  concurrency?: ChannelConcurrency;
  /**
   * What to do when a turn arrives while a prior turn on the same conversationKey is processing.
   *
   * @deprecated Prefer {@link concurrency}. When `concurrency` is unset:
   * `"drop"` → `concurrency: "drop"`, `"force"` → `concurrency: "parallel"`.
   * A callback keeps the legacy lock + drop/force path.
   */
  onLockConflict?:
    | LockConflictDecision
    | ((
        conversationKey: string,
        message: IncomingMessage,
      ) => LockConflictDecision | Promise<LockConflictDecision>);
  /** TTL (ms) for the per-conversation turn lock. Default 60_000. Used by `drop` / legacy paths. */
  lockTtl?: number;
  /** TTL (ms) for the inbound event dedup window. Default 300_000. */
  dedupTtl?: number;
  /** TTL (ms) for durable actions and HITL continuations. Default 604_800_000 (7 days). */
  actionRetentionMs?: number;
}

/**
 * Tuning for how a long reply is spread across continuation messages.
 *
 * Providers cap how much text one message can hold; past that the reply is
 * split, and past {@link ReplyContinuationOptions.maxMessages} it is truncated
 * with a visible marker. Defaults are conservative and suit most bots — reach
 * for these when a provider's real ceiling differs, when a product wants a
 * different tolerance for how many messages one reply may occupy, or when the
 * truncation notice needs to be in another language.
 *
 * Currently honoured by managed and direct Slack.
 */
export interface ReplyContinuationOptions {
  /**
   * Soft cap on the UTF-8 bytes one message may hold before continuing into a
   * new one. Bytes rather than characters because the provider ceiling may be
   * counted either way, and bytes are the safe reading for non-Latin scripts.
   */
  readonly messageByteLimit?: number;
  /**
   * Ceiling on messages a single reply may occupy before it is truncated with a
   * visible marker. Bounds a runaway reply.
   */
  readonly maxMessages?: number;
  /** Notice appended when `maxMessages` is reached. Defaults to English copy. */
  readonly truncationMarker?: string;
}

export interface CreateChannelOptions<
  TStateSchema extends StandardSchemaV1 | undefined = undefined,
> {
  /** Select the canonical application user for every incoming Channel event. */
  identifyUser: ChannelIdentifyUser;
  /**
   * Project-unique Intelligence Channel name. Required for Intelligence Channel
   * Bots — it ties the runtime declaration to the Intelligence setup — and
   * optional for local/custom adapters. Validated by the Channel runtime
   * (`startChannels`), not here.
   */
  name?: string;
  /**
   * Adapters supplied at construction. Optional — adapters can also be attached
   * before the runner starts the channel, via `channel.ɵruntime.addAdapter`
   * (the Channel runtime uses this).
   */
  adapters?: PlatformAdapter[];
  /**
   * Override visible tool-call progress for a managed Channel. Managed Slack
   * defaults to hidden; other managed providers retain their existing default
   * when this is unset.
   *
   * Ignored for direct-adapter Channels. Configure direct Slack with
   * `slack({ showToolStatus: true })` instead.
   */
  showToolStatus?: boolean;
  /**
   * Tuning for splitting a long reply across continuation messages. See
   * {@link ReplyContinuationOptions}. Applies to managed and direct Slack;
   * configure direct Slack with `slack({ replyContinuation })` instead.
   */
  replyContinuation?: ReplyContinuationOptions;
  agent?: AbstractAgent | ((threadId: string) => AbstractAgent);
  /**
   * Tolerate the AG-UI event streams real agents emit. On by default.
   *
   * `@ag-ui/langgraph` emits a `TOOL_CALL_START` whose `parentMessageId` is
   * `null` — notably the tool call that triggers an interrupt — which strict
   * client-side validation rejects, aborting the whole run and breaking
   * human-in-the-loop. Channels coerce that field on the wire so the run
   * survives; see {@link sanitizeAgentEventStream} for exactly what is touched.
   *
   * Set `false` to stream events through unmodified and let a malformed event
   * fail the run. Only meaningful for agents that stream over HTTP — nothing
   * re-validates the events of an in-process agent.
   */
  sanitizeAgentEvents?: boolean;
  /** @deprecated Pass `store.adapter` instead. */
  actionStore?: ActionStore;
  tools?: ChannelTool[];
  context?: ContextEntry[];
  /**
   * Named JSX components used in interactive messages. Registering them here
   * lets the channel re-render and re-fire their handlers after a restart (durable
   * actions); without registration, a click on a message posted before the
   * restart degrades to "action expired".
   */
  components?: ChannelComponent[];
  /** Slash commands. Forwarded to adapters that support them; ignored elsewhere. */
  commands?: ChannelCommand[];
  /** Persistence, per-thread state schema, transcripts, and lock/dedup tuning. */
  store?: StoreConfig<TStateSchema>;
}

export interface Channel<TState = unknown> {
  /** Project-unique identifier from `createChannel({ name })`; used by the Channel runtime. */
  readonly name?: string;
  /** Adapters currently attached to this Channel (read-only snapshot). The Channel runtime uses this to distinguish a managed-eligible Channel (no adapters) from one carrying developer-supplied direct adapters. */
  readonly adapters: readonly PlatformAdapter[];
  /**
   * Managed tool-call visibility override from
   * `createChannel({ showToolStatus })`. Managed Slack defaults to hidden when
   * undefined. Ignored for direct-adapter Channels.
   */
  readonly showToolStatus?: boolean;
  /**
   * Continuation-message tuning from `createChannel({ replyContinuation })`.
   * Undefined leaves the provider defaults in place.
   */
  readonly replyContinuation?: ReplyContinuationOptions;
  /** Declared slash-command names (normalized). Surfaced for Channel activation metadata. */
  readonly commandNames: string[];
  onMention(h: ChannelHandler<TState>): void;
  onMessage(h: ChannelHandler<TState>): void;
  /** Welcome a newly installed or activated provider conversation. */
  onWelcome(h: WelcomeHandler<TState>): void;
  /**
   * A conversation surface opened (e.g. the Slack assistant pane). Greet, set
   * suggested prompts, set a title, or run the agent. Adapters without the
   * concept never fire this.
   */
  onThreadStarted(h: ThreadStartHandler<TState>): void;
  /** Handle clicks on a specific action `id`. `ctx.action.value` is typed as `TValue`. */
  onInteraction<TValue = unknown>(
    id: string,
    h: (ctx: InteractionContext<TValue>) => void | Promise<void>,
  ): void;
  /**
   * Handle an agent interrupt (an `on_interrupt` custom event). `payload` is the
   * event's value; pass `TPayload` to type it, e.g.
   * `onInterrupt<{ question: string }>("ask", ...)`.
   */
  onInterrupt<TPayload = unknown>(
    eventName: string,
    h: (args: {
      payload: TPayload;
      thread: StatefulThread<TState>;
      user: ApplicationUser | null;
      actor: ProviderActor;
    }) => void | Promise<void>,
  ): void;
  /** Register a slash command (with optional typed options). */
  onCommand(command: ChannelCommand): void;
  /** Register a free-text slash command by name. */
  onCommand(
    name: string,
    handler: (ctx: CommandContext) => void | Promise<void>,
  ): void;
  /** React to emoji reactions. Pass emoji name(s) for a specific match, or omit for a catch-all. */
  onReaction(handler: ReactionHandler): void;
  onReaction(emoji: EmojiValue | EmojiValue[], handler: ReactionHandler): void;
  /** Handle a modal submission for `callbackId`. Return `{ errors }` to keep it open. */
  onModalSubmit(callbackId: string, handler: ModalSubmitHandler): void;
  /** Handle a modal dismissal for `callbackId` (Slack `view_closed`). */
  onModalClose(callbackId: string, handler: ModalCloseHandler): void;
  tool(t: ChannelTool): void;
  /** Cross-platform transcript store. Append, list, and delete entries per user. */
  transcripts: Transcripts;
  /**
   * Internal lifecycle seam. Holds the `start`/`stop`/`addAdapter`
   * implementations that the runtime uses to drive the lifecycle directly —
   * there is no public equivalent; channels are runtime-driven only.
   * @internal
   */
  ɵruntime: {
    start(): Promise<void>;
    stop(): Promise<void>;
    addAdapter(adapter: PlatformAdapter): void;
    /** @internal Mark this Channel as attached to an Intelligence Memory backend. */
    enableIntelligenceMemory(): void;
  };
}

/** Build the IncomingMessage object from an IncomingTurn (shared by lock-conflict callback and handler path). */
function msgFromTurn(turn: IncomingTurn): ChannelMessage {
  return {
    text: turn.userText,
    contentParts: turn.contentParts,
    user: null,
    actor: turn.actor,
    ref: turn.messageRef ?? { id: "" },
    platform: turn.platform,
    operation: turn.operation,
    eventId: turn.eventId,
    turnId: turn.turnId,
    deliveryId: turn.deliveryId,
  };
}

function identityContextFromIngress(
  provider: string,
  event: {
    conversationKey?: string;
    actor?: ProviderActor;
    identityContext?: import("./identity.js").IngressIdentityContext;
  },
  trigger: string,
): ChannelIdentityContext {
  const actor: ProviderActor = Object.freeze({
    ...(event.actor ?? { id: "", kind: "unknown" as const }),
  });
  const tenant = Object.freeze({
    ...(event.identityContext?.tenant ?? { id: "" }),
  });
  const installation = Object.freeze({
    ...(event.identityContext?.installation ?? { id: "" }),
  });
  const conversation = Object.freeze({
    ...(event.identityContext?.conversation ?? {
      id: event.conversationKey ?? "",
    }),
  });
  const normalizedEvent = Object.freeze({
    ...event.identityContext?.event,
  });
  return Object.freeze({
    provider,
    tenant,
    installation,
    actor,
    conversation,
    trigger: event.identityContext?.trigger ?? trigger,
    event: normalizedEvent,
    raw: event.identityContext?.raw,
    ...(event.identityContext?.lookupProfile
      ? { lookupProfile: event.identityContext.lookupProfile }
      : {}),
  });
}

/** Resolve the provider that produced an event without changing adapter identity. */
function ingressPlatform(
  adapter: PlatformAdapter,
  event: { platform?: string },
): string {
  return event.platform ?? adapter.platform;
}

/**
 * Resolve the persistence backend at start(): an explicit `store.adapter` wins
 * (silently); otherwise an adapter-provided `stateStore` is used (warning when
 * more than one adapter provides one); otherwise an in-memory store.
 */
function resolveBackend(
  explicit: StateStore | undefined,
  adapters: PlatformAdapter[],
): StateStore {
  if (explicit) return explicit;
  const providers = adapters.filter((a) => a.stateStore);
  if (providers.length > 1) {
    console.warn(
      `[channel] multiple adapters provide a state store (${providers
        .map((a) => a.platform)
        .join(
          ", ",
        )}); using "${providers[0]!.platform}". Pass store.adapter to choose explicitly.`,
    );
  }
  return providers[0]?.stateStore ?? new MemoryStore();
}

export function createChannel<
  TStateSchema extends StandardSchemaV1 | undefined = undefined,
>(
  opts: CreateChannelOptions<TStateSchema>,
): Channel<ThreadStateOf<TStateSchema>> {
  if (
    opts.identifyUser !== "platform" &&
    typeof opts.identifyUser !== "function"
  ) {
    throw new Error(
      'createChannel: `identifyUser` must be "platform" or a callback',
    );
  }
  const cfg = opts.store ?? {};

  // Adapters can be supplied up front or added later via
  // `channel.ɵruntime.addAdapter` (before `channel.ɵruntime.start()`). The
  // runtime uses the latter to attach Channel delivery.
  const adapters: PlatformAdapter[] = [...(opts.adapters ?? [])];
  let started = false;

  // Backend, transcripts, telemetry, the action registry, and component
  // registration are resolved in `ɵruntime.start()` — not at construction —
  // so an adapter added via `ɵruntime.addAdapter` after `createChannel` can
  // still supply the persistence backend (see `resolveBackend`). Nothing
  // reads these before the first event, which can only arrive after
  // `ɵruntime.start()`.
  let backend: StateStore | undefined;
  let transcripts: Transcripts | undefined;
  let registry: ActionRegistry | undefined;
  let telemetry: ChannelTelemetry | undefined;

  const agentFactory: (threadId: string) => AbstractAgent = (() => {
    // Applied here rather than at each call site so a developer never has to
    // know the workaround exists. Idempotent, so reusing one agent instance
    // across threads (or being handed an already-sanitized one) is fine.
    const sanitize =
      opts.sanitizeAgentEvents === false
        ? (agent: AbstractAgent) => agent
        : sanitizeAgentEventStream;
    const a = opts.agent;
    if (!a) {
      return () => {
        throw new Error(
          "createChannel: no agent configured (pass `agent` to use runAgent)",
        );
      };
    }
    // Clone per turn for both shapes, so concurrent turns never share one
    // mutable agent. Isolating only the singleton config is not enough: a
    // factory is free to return the same object on every call. Cloning a fresh
    // factory's result costs an unused instance and closes the shared case —
    // see `isolateAgentInstance`.
    if (typeof a === "function") {
      return (threadId: string) =>
        sanitize(isolateAgentInstance(a(threadId), threadId));
    }
    return (threadId: string) => sanitize(isolateAgentInstance(a, threadId));
  })();

  /** Per-conversation serial turn queue (error-boundaried so one failure cannot poison the chain). */
  const conversationTurnQueues = new Map<string, Promise<void>>();
  function enqueueConversationTurn(
    conversationKey: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const previous =
      conversationTurnQueues.get(conversationKey) ?? Promise.resolve();
    const run = previous.then(work, work);
    // Keep the map tail settled so a rejected turn does not block later ones forever.
    conversationTurnQueues.set(
      conversationKey,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  const toolMap = new Map<string, ChannelTool>();
  for (const t of opts.tools ?? []) toolMap.set(t.name, t);
  const context = opts.context ?? [];

  const mentionHandlers: ChannelHandler[] = [];
  const messageHandlers: ChannelHandler[] = [];
  const welcomeHandlers: WelcomeHandler[] = [];
  const threadStartedHandlers: ThreadStartHandler[] = [];
  const interactionHandlers = new Map<
    string,
    (ctx: InteractionContext) => void | Promise<void>
  >();
  const interruptHandlers = new Map<
    string,
    (args: {
      payload: unknown;
      thread: Thread;
      user: ApplicationUser | null;
      actor: ProviderActor;
    }) => void | Promise<void>
  >();
  const commandHandlers = new Map<string, ChannelCommand>();
  for (const c of opts.commands ?? [])
    commandHandlers.set(normalizeCommandName(c.name), c);
  const reactionHandlers: {
    emojis?: Set<EmojiValue>;
    handler: ReactionHandler;
  }[] = [];
  const modalSubmitHandlers = new Map<string, ModalSubmitHandler>();
  const modalCloseHandlers = new Map<string, ModalCloseHandler>();
  const waiters = new Map<string, (value: unknown) => void>();
  let intelligenceMemoryAvailable = false;

  // Recomputed on start() so tools added via channel.tool() before start are picked up.
  let toolDescriptors = toAgentToolDescriptors([...toolMap.values()]);

  function makeThread(
    adapter: PlatformAdapter,
    replyTarget: unknown,
    conversationKey: string,
    extras?: {
      platform?: string;
      message?: IncomingMessage;
      user?: ApplicationUser | null;
      actor?: ProviderActor;
      interactionActionId?: string;
    },
  ): Thread {
    if (!backend || !registry || !telemetry) {
      throw new Error(
        "channel not started: the runner must start the channel (channel.ɵruntime.start()) before handling events",
      );
    }
    const deps: ThreadDeps = {
      adapter,
      platform: extras?.platform,
      replyTarget,
      conversationKey,
      registry,
      agentFactory,
      tools: toolMap,
      toolDescriptors,
      context,
      registerWaiter: (k, r) => waiters.set(k, r),
      interruptHandlers,
      state: backend,
      stateSchema: cfg.state,
      transcripts,
      message: extras?.message,
      user: extras?.user ?? null,
      actor: extras?.actor ?? { id: "unknown", kind: "unknown" },
      channelName: opts.name ?? adapter.platform,
      threadId: adapter.getCanonicalThreadId?.(replyTarget) ?? conversationKey,
      interactionActionId: extras?.interactionActionId,
      intelligenceMemoryAvailable,
      telemetry,
    };
    return new Thread(deps);
  }

  /**
   * Build the context-level `openModal` closure, or `undefined` when the surface
   * can't open one. Requires both `adapter.openModal` and a platform `triggerId`;
   * otherwise the context omits `openModal` (callers guard `ctx.openModal?.(view)`).
   */
  function makeOpenModal(
    adapter: PlatformAdapter,
    replyTarget: unknown,
    triggerId: string | undefined,
  ):
    | ((view: ModalView) => Promise<{ ok: boolean; error?: string }>)
    | undefined {
    if (!adapter.openModal || !triggerId) return undefined;
    return (view: ModalView) =>
      adapter.openModal!(replyTarget, triggerId, renderToIR(view));
  }

  function makeSink(adapter: PlatformAdapter): IngressSink {
    // backend/registry are resolved in start() before any adapter.start() runs,
    // so they are always set by the time the sink receives an event.
    const store = backend!;

    /**
     * Core turn body (dedup → identity → handlers). Used by all concurrency modes.
     * Dedup marks the event seen at the start so a Slack redelivery of an
     * in-flight event does not double-run under parallel mode either.
     */
    async function processTurn(turn: IncomingTurn): Promise<void> {
      const platform = ingressPlatform(adapter, turn);
      if (!adapter.skipIngressDedup) {
        const dupKey = [
          "message",
          platform,
          turn.operation.kind,
          turn.operation.logicalMessageId,
          turn.operation.revisionId,
        ].join(":");
        try {
          if (await store.dedup.seen(dupKey, cfg.dedupTtl ?? 300_000)) return;
        } catch (err) {
          console.warn(
            `[channel] dedup check failed for ${platform}; processing without dedup`,
            err,
          );
        }
      }

      const identityContext = identityContextFromIngress(
        platform,
        turn,
        "message",
      );
      const user: ApplicationUser | null = await resolveChannelUser(
        opts.identifyUser,
        identityContext,
      );
      const message: ChannelMessage = {
        ...msgFromTurn(turn),
        user,
        actor: identityContext.actor,
      };
      const thread = makeThread(
        adapter,
        turn.replyTarget,
        turn.conversationKey,
        {
          platform,
          message,
          user,
          actor: identityContext.actor,
        },
      );
      const handlers = turn.operation.mentioned
        ? mentionHandlers.length > 0
          ? mentionHandlers
          : messageHandlers
        : messageHandlers;
      for (const h of handlers) await h({ thread, message });
    }

    /**
     * Exclusive-lock path for `drop` and legacy `onLockConflict` callback.
     * A turn dropped on lock-conflict must NOT burn its eventId, so Slack's
     * retry can still be processed once the lock frees — hence dedup lives
     * inside `processTurn` only after we hold the lock (or force through).
     */
    async function processTurnWithLock(turn: IncomingTurn): Promise<void> {
      const lockKey = `turn:${turn.conversationKey}`;
      const acquired = await store.lock.acquire(lockKey, {
        ttlMs: cfg.lockTtl ?? 60_000,
      });

      if (!acquired) {
        const decision =
          typeof cfg.onLockConflict === "function"
            ? await cfg.onLockConflict(turn.conversationKey, msgFromTurn(turn))
            : (cfg.onLockConflict ?? "drop");
        if (decision === "drop") return; // discard overlapping turn
        // "force": proceed WITHOUT a lock token. Does NOT cancel the
        // in-flight handler — cooperative cancellation is a future extension.
      }

      try {
        await processTurn(turn);
      } finally {
        // acquired is null on "force" — naturally skips release.
        if (acquired) await store.lock.release(lockKey, acquired.token);
      }
    }

    return {
      async onTurn(turn: IncomingTurn) {
        const mode = resolveChannelConcurrency(cfg);
        if (mode === "parallel") {
          await processTurn(turn);
          return;
        }
        if (mode === "serial") {
          await enqueueConversationTurn(turn.conversationKey, () =>
            processTurn(turn),
          );
          return;
        }
        // "drop" or legacy callback — exclusive lock + drop/force.
        await processTurnWithLock(turn);
      },
      async onInteraction(evt: InteractionEvent) {
        const platform = ingressPlatform(adapter, evt);
        // Dedup guard: drop duplicate deliveries of the same event within the TTL window.
        if (evt.eventId && !adapter.skipIngressDedup) {
          const dupKey = `evt:${platform}:${evt.eventId}`;
          try {
            if (await store.dedup.seen(dupKey, cfg.dedupTtl ?? 300_000)) return;
          } catch (err) {
            console.warn(
              `[channel] dedup check failed for ${platform}; processing without dedup`,
              err,
            );
          }
        }

        const identityContext = identityContextFromIngress(
          platform,
          evt,
          "interaction",
        );
        const canonicalUser = await resolveChannelUser(
          opts.identifyUser,
          identityContext,
        );
        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
          {
            platform,
            user: canonicalUser,
            actor: identityContext.actor,
            interactionActionId: evt.id,
          },
        );
        const ctx: InteractionContext = {
          thread,
          message: {
            text: "",
            user: canonicalUser,
            actor: identityContext.actor,
            ref: evt.messageRef ?? { id: "" },
            platform,
          },
          action: { id: evt.id, value: evt.value },
          values: evt.values ?? {},
          user: canonicalUser,
          actor: identityContext.actor,
          platform,
        };
        const openModal = makeOpenModal(
          adapter,
          evt.replyTarget,
          evt.triggerId,
        );
        if (openModal) ctx.openModal = openModal;
        // The clicked element's `value`, recovered by the registry when it
        // re-renders to find the handler. Used to resolve a HITL waiter on
        // platforms whose callback payload can't carry the value (Telegram),
        // where `evt.value` is undefined.
        let dispatchedValue: unknown;
        try {
          const explicit = interactionHandlers.get(evt.id);
          if (explicit) {
            await explicit(ctx);
          } else {
            dispatchedValue = await registry!.dispatch(evt.id, ctx);
          }
        } catch (err) {
          // v1: swallow expired-action dispatches; surface anything else. Log
          // the swallow — from the user's side this is a click that does
          // nothing, so without a trace here the failure is invisible on both
          // ends. A retention-window expiry is expected; a burst of these
          // usually means a component's registry name changed under it.
          if (!(err instanceof ActionExpiredError)) throw err;
          console.warn(
            `[channel] ignoring click on expired or unresolvable action "${evt.id}" — its retention window may have passed, or the component that minted it is no longer registered under the same name.`,
          );
        }
        // Resolve any HITL waiter awaiting a choice in this conversation. Prefer
        // the value carried in the event (Slack), falling back to the value the
        // registry recovered from the rendered element (Telegram).
        const w = waiters.get(evt.conversationKey);
        if (w) {
          waiters.delete(evt.conversationKey);
          w(evt.value !== undefined ? evt.value : dispatchedValue);
        }
      },
      async onCommand(cmd: IncomingCommand) {
        const platform = ingressPlatform(adapter, cmd);
        // Dedup guard: drop duplicate deliveries of the same event within the TTL window.
        if (cmd.eventId && !adapter.skipIngressDedup) {
          const dupKey = `evt:${platform}:${cmd.eventId}`;
          try {
            if (await store.dedup.seen(dupKey, cfg.dedupTtl ?? 300_000)) return;
          } catch (err) {
            console.warn(
              `[channel] dedup check failed for ${platform}; processing without dedup`,
              err,
            );
          }
        }

        const command = commandHandlers.get(normalizeCommandName(cmd.command));
        if (!command) return; // unregistered command → skip
        const identityContext = identityContextFromIngress(
          platform,
          cmd,
          "command",
        );
        const user = await resolveChannelUser(
          opts.identifyUser,
          identityContext,
        );
        const thread = makeThread(
          adapter,
          cmd.replyTarget,
          cmd.conversationKey,
          {
            platform,
            user,
            actor: identityContext.actor,
          },
        );
        // Resolve typed options from any structured args the surface supplied
        // (e.g. Discord); text-only surfaces (Slack) leave `options` empty and
        // the handler reads `text`.
        let options: Record<string, unknown> = {};
        if (command.options && cmd.rawOptions) {
          const parsed = await parseToolArgs(command.options, cmd.rawOptions);
          if (parsed.ok) options = parsed.value;
        }
        const ctx: CommandContext<Record<string, unknown>> = {
          thread,
          command: normalizeCommandName(cmd.command),
          text: cmd.text,
          options,
          user,
          actor: identityContext.actor,
          platform,
        };
        const openModal = makeOpenModal(
          adapter,
          cmd.replyTarget,
          cmd.triggerId,
        );
        if (openModal) ctx.openModal = openModal;
        await command.handler(ctx);
      },
      async onWelcome(evt: IncomingWelcome) {
        const platform = ingressPlatform(adapter, evt);
        if (evt.eventId && !adapter.skipIngressDedup) {
          const dupKey = `evt:${platform}:${evt.eventId}`;
          try {
            if (await store.dedup.seen(dupKey, cfg.dedupTtl ?? 300_000)) return;
          } catch (err) {
            console.warn(
              `[channel] dedup check failed for ${platform}; processing welcome without dedup`,
              err,
            );
          }
        }
        const identityContext = identityContextFromIngress(
          platform,
          evt,
          "welcome",
        );
        const user = await resolveChannelUser(
          opts.identifyUser,
          identityContext,
        );
        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
          { platform, user, actor: identityContext.actor },
        );
        for (const h of welcomeHandlers) {
          await h({ thread, user, actor: identityContext.actor, platform });
        }
      },
      async onThreadStarted(evt: IncomingThreadStart) {
        // The adapter has already applied its static defaults (greeting /
        // prompts) before emitting this, so handlers layer on top and never
        // race. Zero handlers → no-op.
        const platform = ingressPlatform(adapter, evt);
        const identityContext = identityContextFromIngress(
          platform,
          evt,
          "thread-start",
        );
        const user = await resolveChannelUser(
          opts.identifyUser,
          identityContext,
        );
        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
          { platform, user, actor: identityContext.actor },
        );
        for (const h of threadStartedHandlers)
          await h({ thread, user, actor: identityContext.actor });
      },
      async onReaction(evt: IncomingReaction) {
        // Normalize by source platform, falling back to adapter identity for
        // direct adapters that do not need per-event provider routing.
        const sourcePlatform = ingressPlatform(adapter, evt);
        const normalized = isEmojiPlatform(sourcePlatform)
          ? normalizeEmoji(evt.rawEmoji, sourcePlatform)
          : undefined;
        const value: EmojiValue = normalized ?? evt.rawEmoji;
        const identityContext = identityContextFromIngress(
          sourcePlatform,
          evt,
          "reaction",
        );
        const user = await resolveChannelUser(
          opts.identifyUser,
          identityContext,
        );
        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
          {
            platform: sourcePlatform,
            user,
            actor: identityContext.actor,
          },
        );
        // Prefer the adapter's update-capable ref; fall back to the bare id.
        const messageRef: MessageRef = evt.messageRef ?? { id: evt.messageId };
        const reactionEvt: ReactionEvent = {
          emoji: value,
          rawEmoji: evt.rawEmoji,
          added: evt.added,
          user,
          actor: identityContext.actor,
          messageId: evt.messageId,
          messageRef,
          threadId: evt.threadId,
          thread,
          adapter,
          raw: evt.raw,
        };
        for (const reg of reactionHandlers) {
          if (!reg.emojis || reg.emojis.has(value))
            await reg.handler(reactionEvt);
        }
        // Per-message handler set via `<Message onReaction>` on the posted
        // message — hot cache, falling back to the durable snapshot after a
        // restart. Resolve by `postedMessageId` when the adapter supplies it
        // (Intelligence Channel: the reaction arrives keyed by the provider ts, not the SDK
        // post ref the handler was persisted under); else by `messageId`.
        const perMessage = await registry!.resolveMessageReaction(
          evt.postedMessageId ?? evt.messageId,
        );
        if (perMessage) {
          await perMessage(value, {
            emoji: value,
            rawEmoji: evt.rawEmoji,
            added: evt.added,
            user,
            actor: identityContext.actor,
            messageId: evt.messageId,
            thread,
            messageRef,
          });
        }
      },
      async onModalSubmit(evt: IncomingModalSubmit) {
        const handler = modalSubmitHandlers.get(evt.callbackId);
        if (!handler) return; // unregistered → closes
        const identityContext = identityContextFromIngress(
          evt.platform,
          evt,
          "modal-submit",
        );
        const user = await resolveChannelUser(
          opts.identifyUser,
          identityContext,
        );
        const thread =
          evt.conversationKey !== undefined && evt.replyTarget !== undefined
            ? makeThread(adapter, evt.replyTarget, evt.conversationKey, {
                platform: evt.platform,
                user,
                actor: identityContext.actor,
              })
            : undefined;
        const result = await handler({
          callbackId: evt.callbackId,
          values: evt.values,
          user,
          actor: identityContext.actor,
          thread,
          privateMetadata: evt.privateMetadata,
          raw: evt.raw,
        });
        return result ?? undefined;
      },
      async onModalClose(evt: IncomingModalClose) {
        const handler = modalCloseHandlers.get(evt.callbackId);
        if (!handler) return;
        const identityContext = identityContextFromIngress(
          evt.platform,
          evt,
          "modal-close",
        );
        const user = await resolveChannelUser(
          opts.identifyUser,
          identityContext,
        );
        await handler({
          callbackId: evt.callbackId,
          user,
          actor: identityContext.actor,
          privateMetadata: evt.privateMetadata,
          raw: evt.raw,
        });
      },
    };
  }

  const channel: Channel<ThreadStateOf<TStateSchema>> = {
    name: opts.name,
    ...(opts.showToolStatus !== undefined
      ? { showToolStatus: opts.showToolStatus }
      : {}),
    ...(opts.replyContinuation !== undefined
      ? { replyContinuation: opts.replyContinuation }
      : {}),
    get adapters() {
      // Defensive read-only copy: mutating the returned array must not affect
      // the Channel's private adapter list.
      return [...adapters];
    },
    get commandNames() {
      return [...commandHandlers.keys()];
    },
    get transcripts() {
      if (!transcripts) {
        throw new Error(
          "channel.transcripts is available after the runner starts the channel (channel.ɵruntime.start())",
        );
      }
      return transcripts;
    },
    ɵruntime: {
      enableIntelligenceMemory() {
        intelligenceMemoryAvailable = true;
      },
      addAdapter(adapter) {
        if (started) {
          throw new Error(
            "channel.ɵruntime.addAdapter must be called before channel.ɵruntime.start()",
          );
        }
        adapters.push(adapter);
      },
      async start() {
        // Idempotent: a second start() must not re-resolve the backend and
        // rebuild Transcripts/Telemetry/ActionRegistry or re-call adapter.start()
        // — with a MemoryStore that wipes all lock/dedup/transcript/action state,
        // and real adapters would connect/port-bind twice.
        if (started) return;
        if (
          adapters.some(
            (adapter) => adapter.capabilities.supportsMessageEvents,
          ) &&
          mentionHandlers.length === 0 &&
          messageHandlers.length === 0
        ) {
          throw new Error(
            `channel "${opts.name ?? "(unnamed)"}" must register onMention or onMessage before activation`,
          );
        }
        started = true;
        // Resolve persistence now that all adapters (including any attached via
        // addAdapter) are known, then build the transcript store, action
        // registry, and register components against it.
        backend = resolveBackend(cfg.adapter, adapters);
        transcripts = new Transcripts(backend, cfg.transcripts ?? {});
        const tel = new ChannelTelemetry({
          backend,
          packageName: pkg.name,
          packageVersion: pkg.version,
        });
        telemetry = tel;
        const registryInstance = new ActionRegistry({
          store:
            opts.actionStore ??
            kvActionStore(backend, {
              defaultTtlMs: cfg.actionRetentionMs ?? 7 * 24 * 60 * 60 * 1000,
            }),
          retentionMs: cfg.actionRetentionMs ?? 7 * 24 * 60 * 60 * 1000,
        });
        registry = registryInstance;
        for (const c of opts.components ?? []) {
          // Prefer the pinned `displayName` over `fn.name`: the latter is a
          // build artifact, and a bundler that mangles it between deploys makes
          // every already-posted button undispatchable.
          const componentName = resolveComponentName(c);
          if (!componentName) {
            console.warn(
              "[channel] createChannel: skipping anonymous component — wrap it in defineChannelComponent('Name', fn) to enable durable actions after restart.",
            );
            continue;
          }
          registryInstance.registerComponent(
            componentName,
            c as unknown as ComponentFn,
          );
        }
        toolDescriptors = toAgentToolDescriptors([...toolMap.values()]);
        tel.capture("oss.channel.configured", {
          platforms: adapters.map((a) => normalizePlatform(a.platform)),
          adapterCount: adapters.length,
          store: storeKind(backend),
          hasComponents: (opts.components?.length ?? 0) > 0,
          componentsCount: opts.components?.length ?? 0,
          toolsCount: toolMap.size,
          commandsCount: commandHandlers.size,
          contextCount: context.length,
          transcripts: !!cfg.transcripts,
        });
        // Isolate per-adapter startup failures: one adapter rejecting (e.g.
        // Telegram's setMyCommands rejecting a hyphenated command name, a revoked
        // token, a port already in use) must NOT crash the channel or prevent the
        // other adapters from starting. Log + degrade, never throw.
        const startResults = await Promise.allSettled(
          adapters.map((a) => a.start(makeSink(a), { channelName: opts.name })),
        );
        const startedPlatforms: string[] = [];
        const failedPlatforms: string[] = [];
        startResults.forEach((r, i) => {
          const rawPlatform = adapters[i]!.platform;
          // Raw label for the human-facing log; normalized label for telemetry.
          const platform = normalizePlatform(rawPlatform);
          if (r.status === "rejected") {
            failedPlatforms.push(platform);
            console.error(
              `[channel] adapter "${rawPlatform}" failed to start:`,
              r.reason,
            );
            tel.capture("oss.channel.start_failed", {
              platform,
              errorClass: errorClass(r.reason),
            });
          } else {
            startedPlatforms.push(platform);
          }
        });
        const managedFailureIndex = startResults.findIndex(
          (result, index) =>
            adapters[index]?.__intelligenceChannel === true &&
            result.status === "rejected",
        );
        const stopAdapters = async (
          indexes: readonly number[],
          reason: string,
        ) => {
          const rollbackResults = await Promise.allSettled(
            indexes.map(
              (index) =>
                new Promise<void>((resolve, reject) => {
                  let settled = false;
                  const timeout = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    reject(
                      new Error(
                        `stop timed out after ${ADAPTER_ROLLBACK_TIMEOUT_MS}ms`,
                      ),
                    );
                  }, ADAPTER_ROLLBACK_TIMEOUT_MS);
                  void Promise.resolve()
                    .then(() => adapters[index]!.stop())
                    .then(
                      () => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        resolve();
                      },
                      (error: unknown) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        reject(error);
                      },
                    );
                }),
            ),
          );
          rollbackResults.forEach((result, resultIndex) => {
            if (result.status === "rejected") {
              const adapterIndex = indexes[resultIndex]!;
              console.error(
                `[channel] adapter "${adapters[adapterIndex]!.platform}" failed to stop ${reason}:`,
                result.reason,
              );
            }
          });
        };
        const allAdapterIndexes = adapters.map((_adapter, index) => index);
        const rejectedAdapterIndexes = startResults.flatMap((result, index) =>
          result.status === "rejected" ? [index] : [],
        );
        if (managedFailureIndex >= 0) {
          // Managed activation must never report online merely because a
          // coexisting direct adapter started. Roll back every attempted
          // adapter, including the rejecting managed adapter, because start()
          // may have acquired resources before it failed.
          await stopAdapters(
            allAdapterIndexes,
            "after managed activation failed",
          );
          started = false;
          throw new Error(
            `channel "${opts.name ?? "(unnamed)"}" failed to start its managed Intelligence adapter`,
          );
        }
        // A channel that has adapters but where NONE started is dead — surface an
        // error so the runtime reports status "error", not a false "online". A
        // PARTIAL start (>=1 adapter live) still counts as started. Reset the
        // `started` guard so a caller can retry after fixing the misconfiguration.
        if (adapters.length > 0 && startedPlatforms.length === 0) {
          await stopAdapters(
            allAdapterIndexes,
            "after all adapters failed to start",
          );
          started = false;
          throw new Error(
            `channel "${opts.name ?? "(unnamed)"}" failed to start: all ${failedPlatforms.length} adapter(s) failed to connect (${failedPlatforms.join(", ")}) — see the logged errors above`,
          );
        }
        if (rejectedAdapterIndexes.length > 0) {
          // A rejecting start may still have acquired a listener or provider
          // client. Release only those failed adapters while preserving the
          // healthy adapters that make this a valid degraded start.
          await stopAdapters(rejectedAdapterIndexes, "after its start failed");
        }
        if (startedPlatforms.length > 0) {
          tel.capture("oss.channel.started", {
            platforms: startedPlatforms,
            startedCount: startedPlatforms.length,
            failedCount: failedPlatforms.length,
            hasMentionHandler: mentionHandlers.length > 0,
            hasMessageHandler: messageHandlers.length > 0,
            interruptHandlers: interruptHandlers.size,
            commandsCount: commandHandlers.size,
            toolsCount: toolMap.size,
          });
        }
        // Hand declared commands to adapters that register them up front (e.g.
        // Discord); adapters without `registerCommands` are skipped. Never call
        // into adapters whose start failed and whose resources were just
        // cleaned up. Per-adapter failures are isolated the same way as start().
        const commandSpecs = [...commandHandlers.values()].map(toCommandSpec);
        if (commandSpecs.length > 0) {
          const startedAdapterIndexes = startResults.flatMap((result, index) =>
            result.status === "fulfilled" ? [index] : [],
          );
          const registerResults = await Promise.allSettled(
            startedAdapterIndexes.map((index) =>
              adapters[index]!.registerCommands?.(commandSpecs),
            ),
          );
          registerResults.forEach((r, resultIndex) => {
            if (r.status === "rejected") {
              const adapterIndex = startedAdapterIndexes[resultIndex]!;
              console.error(
                `[channel] adapter "${adapters[adapterIndex]!.platform}" failed to register commands:`,
                r.reason,
              );
            }
          });
        }
      },
      async stop() {
        // Clear the started flag so a later start() is a real restart (re-resolve
        // backend, rebuild components, reconnect adapters) rather than a silent
        // no-op. The idempotency guard in start() only exists to block a DOUBLE
        // start() while running — not a legitimate start→stop→start cycle.
        started = false;
        // Isolate per-adapter shutdown failures: one adapter's stop() rejecting
        // must not prevent the others from being stopped.
        const stopResults = await Promise.allSettled(
          adapters.map((a) => Promise.resolve().then(() => a.stop())),
        );
        stopResults.forEach((r, i) => {
          if (r.status === "rejected") {
            console.error(
              `[channel] adapter "${adapters[i]!.platform}" failed to stop:`,
              r.reason,
            );
          }
        });
      },
    },
    onMention(h) {
      // The public surface narrows `thread` to StatefulThread<TState>; the
      // internal arrays hold the loose `ChannelHandler` shape. A real Thread is
      // assignable to StatefulThread<TState> (its generic setState/state
      // satisfy the narrowed signatures), so the cast is sound.
      mentionHandlers.push(h as ChannelHandler);
    },
    onMessage(h) {
      messageHandlers.push(h as ChannelHandler);
    },
    onWelcome(h) {
      welcomeHandlers.push(h as WelcomeHandler);
    },
    onThreadStarted(h) {
      threadStartedHandlers.push(h as ThreadStartHandler);
    },
    onInteraction<TValue = unknown>(
      id: string,
      h: (ctx: InteractionContext<TValue>) => void | Promise<void>,
    ) {
      interactionHandlers.set(
        id,
        h as (ctx: InteractionContext) => void | Promise<void>,
      );
    },
    onInterrupt<TPayload = unknown>(
      eventName: string,
      h: (args: {
        payload: TPayload;
        thread: StatefulThread<ThreadStateOf<TStateSchema>>;
        user: ApplicationUser | null;
        actor: ProviderActor;
      }) => void | Promise<void>,
    ) {
      interruptHandlers.set(
        eventName,
        h as (args: {
          payload: unknown;
          thread: Thread;
          user: ApplicationUser | null;
          actor: ProviderActor;
        }) => void | Promise<void>,
      );
    },
    onCommand(
      commandOrName: ChannelCommand | string,
      handler?: (ctx: CommandContext) => void | Promise<void>,
    ) {
      const command: ChannelCommand =
        typeof commandOrName === "string"
          ? {
              name: commandOrName,
              handler: handler as ChannelCommand["handler"],
            }
          : commandOrName;
      commandHandlers.set(normalizeCommandName(command.name), command);
    },
    onReaction(
      emojiOrHandler: EmojiValue | EmojiValue[] | ReactionHandler,
      maybeHandler?: ReactionHandler,
    ) {
      if (typeof emojiOrHandler === "function") {
        reactionHandlers.push({ handler: emojiOrHandler });
        return;
      }
      const list = Array.isArray(emojiOrHandler)
        ? emojiOrHandler
        : [emojiOrHandler];
      // Ingress normalizes inbound reactions to their canonical name, so
      // normalize the caller's filter tokens too — otherwise a raw unicode
      // ("👍") or Slack alias ("thumbsup") filter would never match the
      // canonical "thumbs_up" the engine compares against. Unknown/custom
      // tokens pass through unchanged.
      const emojis = new Set(list.map((e) => toCanonicalEmoji(e)));
      reactionHandlers.push({ emojis, handler: maybeHandler! });
    },
    onModalSubmit(callbackId, handler) {
      modalSubmitHandlers.set(callbackId, handler);
    },
    onModalClose(callbackId, handler) {
      modalCloseHandlers.set(callbackId, handler);
    },
    tool(t) {
      toolMap.set(t.name, t);
    },
  };
  return channel;
}
