import type {
  PlatformAdapter,
  IngressSink,
  IncomingTurn,
  InteractionEvent,
  IncomingCommand,
  IncomingThreadStart,
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
import type {
  InteractionContext,
  IncomingMessage,
  PlatformUser,
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
} from "@copilotkit/channels-ui";
import { Transcripts } from "./transcripts.js";
import type { Identity, TranscriptsConfig } from "./transcripts.js";
import type { StandardSchemaV1, InferSchemaOutput } from "./standard-schema.js";
import { ChannelTelemetry } from "./telemetry/channel-telemetry.js";
import { errorClass, normalizePlatform } from "./telemetry/sanitize-error.js";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as {
  name: string;
  version: string;
};

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
 * The managed delivery provider a no-adapter Channel targets when it is
 * activated through CopilotKit Intelligence.
 *
 * This is the platform the runtime *declares* to the Intelligence gateway on
 * join; the gateway resolves the actual connection (workspace, credentials,
 * transport) for that provider. It is a per-Channel choice — one runtime can
 * declare a Slack-backed Channel and a Teams-backed Channel side by side.
 *
 * A CLOSED union of the providers the gateway has real/coordinated support for.
 * `"slack"` is generally available. `"teams"` is GATED/COORDINATED: the gateway
 * accepts only `"slack"` at join today, so declaring `provider: "teams"` is
 * SDK-ready but NOT generally available until the coordinated gateway path lands
 * (Intelligence OSS-450 / #511).
 *
 * Distinct from a {@link PlatformAdapter} attached via
 * `createChannel({ adapters })` / `channel.ɵruntime.addAdapter`: an adapter is
 * a *direct*, developer-owned connection this handler does not manage,
 * whereas `provider` selects the *managed* platform for a Channel with no
 * adapters.
 */
export type ManagedChannelProvider = "slack" | "teams";

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
  message: IncomingMessage;
}) => void | Promise<void>;

/** Handler for a "conversation opened" lifecycle event (e.g. the Slack assistant pane). */
export type ThreadStartHandler<TState = unknown> = (ctx: {
  thread: StatefulThread<TState>;
  user?: PlatformUser;
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
  user?: PlatformUser;
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
  user?: PlatformUser;
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
  user?: PlatformUser;
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
  /** Resolve a stable cross-platform identity key (e.g. email). Paired with `transcripts`. */
  identity?: Identity;
  /** Cross-platform transcript storage config. Paired with `identity`. */
  transcripts?: TranscriptsConfig;
  /** What to do when a turn arrives while a prior turn on the same conversationKey is processing. */
  onLockConflict?:
    | LockConflictDecision
    | ((
        conversationKey: string,
        message: IncomingMessage,
      ) => LockConflictDecision | Promise<LockConflictDecision>);
  /** TTL (ms) for the per-conversation turn lock. Default 60_000. */
  lockTtl?: number;
  /** TTL (ms) for the inbound event dedup window. Default 300_000. */
  dedupTtl?: number;
}

export interface CreateChannelOptions<
  TStateSchema extends StandardSchemaV1 | undefined = undefined,
> {
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
   * The managed delivery provider this Channel targets when it is activated via
   * CopilotKit Intelligence (a no-adapter, managed Channel). The runtime
   * declares this provider to the Intelligence gateway on join; the gateway
   * resolves the actual connection. Defaults to `"slack"` when unset.
   *
   * `provider: "teams"` is GATED: it is SDK-ready, but the gateway accepts only
   * `"slack"` at join today, so Teams is not generally available until the
   * coordinated gateway path lands (Intelligence OSS-450 / #511). See
   * {@link ManagedChannelProvider}.
   *
   * Ignored for direct-adapter Channels (those created with `adapters` /
   * `channel.ɵruntime.addAdapter`) — a direct Channel is owned by the
   * developer's own adapter, not by managed activation.
   */
  provider?: ManagedChannelProvider;
  agent?: AbstractAgent | ((threadId: string) => AbstractAgent);
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
   * The managed delivery provider a no-adapter Channel targets when activated
   * via CopilotKit Intelligence (from `createChannel({ provider })`). Declared
   * to the Intelligence gateway on join; `undefined` means the managed default
   * (`"slack"`). Ignored for direct-adapter Channels.
   */
  readonly provider?: ManagedChannelProvider;
  /** Declared slash-command names (normalized). Surfaced for Channel activation metadata. */
  readonly commandNames: string[];
  onMention(h: ChannelHandler<TState>): void;
  onMessage(h: ChannelHandler<TState>): void;
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
   * there is no public equivalent; channels are runtime-driven only. (Read the
   * managed provider off the top-level `channel.provider`, not here.)
   * @internal
   */
  ɵruntime: {
    start(): Promise<void>;
    stop(): Promise<void>;
    addAdapter(adapter: PlatformAdapter): void;
  };
}

/** Build the IncomingMessage object from an IncomingTurn (shared by lock-conflict callback and handler path). */
function msgFromTurn(turn: IncomingTurn): IncomingMessage {
  return {
    text: turn.userText,
    contentParts: turn.contentParts,
    user: turn.user ?? { id: "" },
    ref: { id: "" },
    platform: turn.platform,
    eventId: turn.eventId,
    turnId: turn.turnId,
    deliveryId: turn.deliveryId,
  };
}

/**
 * Enforce V1 Intelligence Channel exclusivity: an Intelligence Channel adapter
 * (`intelligenceAdapter`) must be the only adapter on a Channel. Channel and direct delivery are
 * alternative modes on a Channel — Intelligence holds the platform creds, or
 * the runtime does, never both.
 */
function assertExclusive(adapters: PlatformAdapter[]): void {
  if (adapters.some((a) => a.__intelligenceChannel) && adapters.length > 1) {
    throw new Error(
      "intelligenceAdapter() must be the only adapter on a Channel — Channel and " +
        "direct delivery are alternative modes. Use intelligenceAdapter() OR " +
        "direct adapters (slack/discord/...), not both.",
    );
  }
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
  const cfg = opts.store ?? {};
  if (
    (cfg.identity && !cfg.transcripts) ||
    (!cfg.identity && cfg.transcripts)
  ) {
    throw new Error(
      "createChannel: `identity` and `transcripts` must be configured together.",
    );
  }

  // Adapters can be supplied up front or added later via
  // `channel.ɵruntime.addAdapter` (before `channel.ɵruntime.start()`). The
  // runtime uses the latter to attach Channel delivery.
  const adapters: PlatformAdapter[] = [...(opts.adapters ?? [])];
  assertExclusive(adapters);
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
    const a = opts.agent;
    if (typeof a === "function")
      return a as (threadId: string) => AbstractAgent;
    if (a) return () => a;
    return () => {
      throw new Error(
        "createChannel: no agent configured (pass `agent` to use runAgent)",
      );
    };
  })();

  const toolMap = new Map<string, ChannelTool>();
  for (const t of opts.tools ?? []) toolMap.set(t.name, t);
  const context = opts.context ?? [];

  const mentionHandlers: ChannelHandler[] = [];
  const messageHandlers: ChannelHandler[] = [];
  const threadStartedHandlers: ThreadStartHandler[] = [];
  const interactionHandlers = new Map<
    string,
    (ctx: InteractionContext) => void | Promise<void>
  >();
  const interruptHandlers = new Map<
    string,
    (args: { payload: unknown; thread: Thread }) => void | Promise<void>
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

  // Recomputed on start() so tools added via channel.tool() before start are picked up.
  let toolDescriptors = toAgentToolDescriptors([...toolMap.values()]);

  function makeThread(
    adapter: PlatformAdapter,
    replyTarget: unknown,
    conversationKey: string,
    extras?: { userKey?: string; message?: IncomingMessage },
  ): Thread {
    if (!backend || !registry || !telemetry) {
      throw new Error(
        "channel not started: the runner must start the channel (channel.ɵruntime.start()) before handling events",
      );
    }
    const deps: ThreadDeps = {
      adapter,
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
      userKey: extras?.userKey,
      message: extras?.message,
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
    return {
      async onTurn(turn: IncomingTurn) {
        const lockKey = `turn:${turn.conversationKey}`;
        const acquired = await store.lock.acquire(lockKey, {
          ttlMs: cfg.lockTtl ?? 60_000,
        });

        if (!acquired) {
          const decision =
            typeof cfg.onLockConflict === "function"
              ? await cfg.onLockConflict(
                  turn.conversationKey,
                  msgFromTurn(turn),
                )
              : (cfg.onLockConflict ?? "drop");
          if (decision === "drop") return; // discard overlapping turn
          // "force": proceed WITHOUT a lock token. Does NOT cancel the
          // in-flight handler — cooperative cancellation is a future extension.
        }

        try {
          // Dedup AFTER acquiring the lock: a turn dropped on lock-conflict must NOT burn its
          // eventId, so Slack's retry can still be processed once the lock frees. (A handler
          // that throws still leaves its event marked seen — dedup drops duplicate DELIVERIES,
          // it is not retry-of-failed-turns.)
          if (turn.eventId && !adapter.skipIngressDedup) {
            const dupKey = `evt:${adapter.platform}:${turn.eventId}`;
            try {
              if (await store.dedup.seen(dupKey, cfg.dedupTtl ?? 300_000))
                return;
            } catch (err) {
              console.warn(
                `[channel] dedup check failed for ${adapter.platform}; processing without dedup`,
                err,
              );
            }
          }

          // Resolve cross-platform identity key (if configured) and stamp it on
          // the message so handlers and transcript storage can use it. Done
          // BEFORE makeThread so the thread carries the userKey + message for
          // the transcript auto-bridge (runAgent({ transcript: true })).
          let userKey: string | undefined;
          if (cfg.identity) {
            try {
              const resolved = await cfg.identity({
                adapter: adapter.platform,
                author: turn.user ?? { id: "" },
                message: msgFromTurn(turn),
              });
              userKey = resolved ?? undefined;
            } catch (err) {
              console.warn(
                `[channel] identity resolution failed for ${adapter.platform}; continuing without userKey`,
                err,
              );
            }
          }
          const message: IncomingMessage = { ...msgFromTurn(turn), userKey };
          const thread = makeThread(
            adapter,
            turn.replyTarget,
            turn.conversationKey,
            { userKey, message },
          );
          // v1 routing: there is no turn `kind`, so prefer mention handlers; if
          // none are registered, fall back to message handlers. (The reference
          // example registers identical handlers on both, so this avoids
          // double-firing while still invoking whatever is registered.)
          const handlers =
            mentionHandlers.length > 0 ? mentionHandlers : messageHandlers;
          for (const h of handlers) await h({ thread, message });
        } finally {
          // acquired is null on "force" — naturally skips release.
          if (acquired) await store.lock.release(lockKey, acquired.token);
        }
      },
      async onInteraction(evt: InteractionEvent) {
        // Dedup guard: drop duplicate deliveries of the same event within the TTL window.
        if (evt.eventId && !adapter.skipIngressDedup) {
          const dupKey = `evt:${adapter.platform}:${evt.eventId}`;
          try {
            if (await store.dedup.seen(dupKey, cfg.dedupTtl ?? 300_000)) return;
          } catch (err) {
            console.warn(
              `[channel] dedup check failed for ${adapter.platform}; processing without dedup`,
              err,
            );
          }
        }

        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
        );
        const user = evt.user ?? { id: "" };
        const ctx: InteractionContext = {
          thread,
          message: {
            text: "",
            user,
            ref: evt.messageRef ?? { id: "" },
            platform: adapter.platform,
          },
          action: { id: evt.id, value: evt.value },
          values: {},
          user,
          platform: adapter.platform,
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
          // v1: swallow expired-action dispatches; surface anything else.
          if (!(err instanceof ActionExpiredError)) throw err;
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
        // Dedup guard: drop duplicate deliveries of the same event within the TTL window.
        if (cmd.eventId && !adapter.skipIngressDedup) {
          const dupKey = `evt:${adapter.platform}:${cmd.eventId}`;
          try {
            if (await store.dedup.seen(dupKey, cfg.dedupTtl ?? 300_000)) return;
          } catch (err) {
            console.warn(
              `[channel] dedup check failed for ${adapter.platform}; processing without dedup`,
              err,
            );
          }
        }

        const command = commandHandlers.get(normalizeCommandName(cmd.command));
        if (!command) return; // unregistered command → skip
        const thread = makeThread(
          adapter,
          cmd.replyTarget,
          cmd.conversationKey,
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
          user: cmd.user,
          platform: cmd.platform,
        };
        const openModal = makeOpenModal(
          adapter,
          cmd.replyTarget,
          cmd.triggerId,
        );
        if (openModal) ctx.openModal = openModal;
        await command.handler(ctx);
      },
      async onThreadStarted(evt: IncomingThreadStart) {
        // The adapter has already applied its static defaults (greeting /
        // prompts) before emitting this, so handlers layer on top and never
        // race. Zero handlers → no-op.
        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
        );
        for (const h of threadStartedHandlers)
          await h({ thread, user: evt.user });
      },
      async onReaction(evt: IncomingReaction) {
        // Normalize by the reaction's SOURCE platform: direct adapters omit
        // `evt.platform`, so it falls back to `adapter.platform`; the managed
        // path (adapter.platform === "intelligence") sets `evt.platform` to the
        // originating provider (e.g. "teams"/"slack") so central normalization
        // still runs. Only normalize when that platform is one the emoji table
        // knows; otherwise the raw token passes through unchanged.
        const sourcePlatform = evt.platform ?? adapter.platform;
        const normalized = isEmojiPlatform(sourcePlatform)
          ? normalizeEmoji(evt.rawEmoji, sourcePlatform)
          : undefined;
        const value: EmojiValue = normalized ?? evt.rawEmoji;
        const thread = makeThread(
          adapter,
          evt.replyTarget,
          evt.conversationKey,
        );
        // Prefer the adapter's update-capable ref; fall back to the bare id.
        const messageRef: MessageRef = evt.messageRef ?? { id: evt.messageId };
        const reactionEvt: ReactionEvent = {
          emoji: value,
          rawEmoji: evt.rawEmoji,
          added: evt.added,
          user: evt.user,
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
            user: evt.user,
            messageId: evt.messageId,
            thread,
            messageRef,
          });
        }
      },
      async onModalSubmit(evt: IncomingModalSubmit) {
        const handler = modalSubmitHandlers.get(evt.callbackId);
        if (!handler) return; // unregistered → closes
        const thread =
          evt.conversationKey !== undefined && evt.replyTarget !== undefined
            ? makeThread(adapter, evt.replyTarget, evt.conversationKey)
            : undefined;
        const result = await handler({
          callbackId: evt.callbackId,
          values: evt.values,
          user: evt.user,
          thread,
          privateMetadata: evt.privateMetadata,
          raw: evt.raw,
        });
        return result ?? undefined;
      },
      async onModalClose(evt: IncomingModalClose) {
        const handler = modalCloseHandlers.get(evt.callbackId);
        if (!handler) return;
        await handler({
          callbackId: evt.callbackId,
          user: evt.user,
          privateMetadata: evt.privateMetadata,
          raw: evt.raw,
        });
      },
    };
  }

  const channel: Channel<ThreadStateOf<TStateSchema>> = {
    name: opts.name,
    ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
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
      addAdapter(adapter) {
        if (started) {
          throw new Error(
            "channel.ɵruntime.addAdapter must be called before channel.ɵruntime.start()",
          );
        }
        assertExclusive([...adapters, adapter]);
        adapters.push(adapter);
      },
      async start() {
        // Idempotent: a second start() must not re-resolve the backend and
        // rebuild Transcripts/Telemetry/ActionRegistry or re-call adapter.start()
        // — with a MemoryStore that wipes all lock/dedup/transcript/action state,
        // and real adapters would connect/port-bind twice.
        if (started) return;
        started = true;
        assertExclusive(adapters);
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
          store: opts.actionStore ?? kvActionStore(backend),
        });
        registry = registryInstance;
        for (const c of opts.components ?? []) {
          if (!c.name) {
            console.warn(
              "[channel] createChannel: skipping anonymous component — give it a name to enable durable actions after restart.",
            );
            continue;
          }
          registryInstance.registerComponent(
            c.name,
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
          identity: !!cfg.identity,
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
        // Discord); adapters without `registerCommands` are skipped. Per-adapter
        // failures are isolated the same way as start().
        const commandSpecs = [...commandHandlers.values()].map(toCommandSpec);
        if (commandSpecs.length > 0) {
          const registerResults = await Promise.allSettled(
            adapters.map((a) => a.registerCommands?.(commandSpecs)),
          );
          registerResults.forEach((r, i) => {
            if (r.status === "rejected") {
              console.error(
                `[channel] adapter "${adapters[i]!.platform}" failed to register commands:`,
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
          adapters.map((a) => a.stop()),
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
      }) => void | Promise<void>,
    ) {
      interruptHandlers.set(
        eventName,
        h as (args: {
          payload: unknown;
          thread: Thread;
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
