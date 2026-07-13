import type { AgentSubscriber, AbstractAgent } from "@ag-ui/client";
import type {
  AgentContentPart,
  BotNode,
  EmojiValue,
  EphemeralResult,
  MessageRef,
  PlatformUser,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import type { CommandSpec } from "./commands.js";
import type { StateStore } from "./state/state-store.js";

/** Opaque to the bot core — created by an adapter during ingress and passed back to post/createRunRenderer. */
export type ReplyTarget = unknown;
/** Opaque native payload produced by an adapter's render(). */
export type NativePayload = unknown;

export interface SurfaceCapabilities {
  supportsModals: boolean;
  supportsTyping: boolean;
  supportsReactions: boolean;
  supportsStreaming: boolean;
  maxBlocksPerMessage?: number;
  /** Pinned prompt chips on a conversation surface (Slack assistant pane). */
  supportsSuggestedPrompts?: boolean;
  /** Nameable conversations (Slack assistant-thread titles). */
  supportsThreadTitle?: boolean;
  /** Native ephemeral messages (Slack). When false, `postEphemeral` still works via DM fallback. */
  supportsEphemeral?: boolean;
  /**
   * Whether `Thread.awaitChoice` can block synchronously for a user's click
   * within a single run. `true`/undefined on interactive surfaces (Slack Socket
   * Mode, Discord, …). Set `false` on ack-first surfaces like the Intelligence
   * Intelligence HTTP loop, where a run must end after posting the picker and
   * resume on the click's separate inbound delivery (a blocking wait would
   * deadlock the one-delivery-at-a-time claim loop). The HITL resume flow will
   * gate on this; no code reads it yet (forward-declared for that work).
   */
  supportsBlockingChoice?: boolean;
  [k: string]: unknown;
}

export interface CapturedToolCall {
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
}
export interface CapturedInterrupt {
  eventName: string;
  value: unknown;
}

/** A per-run handle: the AG-UI subscriber to stream into, plus capture accessors the run-loop reads after each runAgent. */
export interface RunRenderer {
  subscriber: AgentSubscriber;
  markInterrupted(): Promise<void>;
  getCapturedToolCalls(): readonly CapturedToolCall[];
  getPendingInterrupt(): CapturedInterrupt | undefined;
  clearPendingInterrupt(): void;
  /**
   * Optional turn-end hook. Called once after the run-loop resolves normally
   * (no more tool calls, or an interrupt was acked), so a renderer that keeps a
   * turn-scoped resource open across `runAgent` iterations — e.g. a single
   * native streaming message that interleaves text and tool-progress — can
   * finalize it. Symmetric with {@link markInterrupted}; renderers whose
   * streams self-terminate per message simply omit it. Must be a no-op if the
   * run was already interrupted.
   */
  finish?(): Promise<void>;
}

/**
 * Fields shared by every ingress event routed through the {@link IngressSink}:
 * the conversation it belongs to, the opaque target to reply on, and the user
 * who triggered it (when the platform reports one).
 */
export interface IngressEventBase {
  conversationKey: string;
  replyTarget: ReplyTarget;
  user?: PlatformUser;
}

/**
 * Idempotency ids carried by turn/command/interaction ingress. Set on the
 * Intelligence Channel path; local adapters omit them.
 */
export interface IngressIds {
  /** Stable platform event id for idempotency; omit if the platform provides none. */
  eventId?: string;
  /** Stable per-turn id (Intelligence Channel path); local adapters omit it. */
  turnId?: string;
  /** Lease/delivery id (Intelligence Channel path); local adapters omit it. */
  deliveryId?: string;
}

export interface IncomingTurn extends IngressEventBase, IngressIds {
  userText: string;
  /**
   * Optional multimodal content parts built by the adapter (e.g. inbound
   * image/file attachments). Carried through to `IncomingMessage.contentParts`.
   */
  contentParts?: AgentContentPart[];
  platform: string;
}

export interface InteractionEvent extends IngressEventBase, IngressIds {
  id: string; // opaque minted action id (ck:...)
  value?: unknown;
  /** The message the interaction occurred on (the picker), so handlers can update it in place. */
  messageRef?: MessageRef;
  /** Opaque platform trigger for opening a modal (Slack `trigger_id`; Discord interaction id). */
  triggerId?: string;
}

/** A slash-command invocation normalized by an adapter. */
export interface IncomingCommand extends IngressEventBase, IngressIds {
  /** Command name as invoked (a leading slash and case are normalized by the engine). */
  command: string;
  /** Raw argument string after the command name (the form text-only surfaces deliver). */
  text: string;
  /** Structured, pre-parsed options when the surface delivers them (e.g. Discord). */
  rawOptions?: Record<string, unknown>;
  platform: string;
  /** Opaque platform trigger for opening a modal (Slack `trigger_id`; Discord interaction id). */
  triggerId?: string;
}

/**
 * A "conversation opened" lifecycle event (Slack: `assistant_thread_started`).
 * Adapters without the concept never emit it.
 */
export interface IncomingThreadStart extends IngressEventBase {
  platform: string;
}

/** A reaction added/removed on a message. Adapters that can't observe reactions never emit it. */
export interface IncomingReaction extends IngressEventBase {
  /** Platform-native emoji token (Slack shortcode, Unicode, Discord custom). */
  rawEmoji: string;
  /** true = added, false = removed. */
  added: boolean;
  /** Id of the reacted-to message. */
  messageId: string;
  /**
   * Key under which a `<Message onReaction>` handler was persisted for this
   * message, when it differs from {@link messageId}. Needed on adapters where
   * the reaction arrives keyed by a provider id (e.g. a Slack `ts`) while the
   * handler was registered under the SDK post-time ref — the engine resolves
   * the per-message handler by `postedMessageId ?? messageId`. Omit when the
   * reacted-message id already equals the post ref (the common case).
   */
  postedMessageId?: string;
  /**
   * Update-capable ref to the reacted message (the platform-specific shape the
   * adapter's `update`/`delete` accept). Lets a `<Message onReaction>` handler
   * swap the message's UI in place. Adapters that can edit messages should set
   * this; the engine falls back to `{ id: messageId }` when omitted.
   */
  messageRef?: MessageRef;
  /** Containing thread/conversation id, when distinct from the message. */
  threadId?: string;
  /** Native payload. */
  raw: unknown;
}

/** A modal submission. Adapters without modals never emit it. */
export interface IncomingModalSubmit {
  callbackId: string;
  /** Field id → value (text string, selected option value, etc.). */
  values: Record<string, unknown>;
  user?: PlatformUser;
  privateMetadata?: string;
  /** Present when the submission carries a conversation context (so the engine can build a Thread). */
  conversationKey?: string;
  replyTarget?: ReplyTarget;
  platform: string;
  raw: unknown;
}

/** A modal dismissal (Slack `view_closed`; requires `notifyOnClose`). */
export interface IncomingModalClose {
  callbackId: string;
  user?: PlatformUser;
  privateMetadata?: string;
  /** Present when the dismissal carries a conversation context (so the engine can build a Thread). */
  conversationKey?: string;
  replyTarget?: ReplyTarget;
  platform: string;
  raw: unknown;
}

/** What a submit handler may return to keep the modal open with per-field errors. */
export interface ModalSubmitResult {
  errors?: Record<string, string>;
}

export interface IngressSink {
  onTurn(turn: IncomingTurn): void | Promise<void>;
  onInteraction(evt: InteractionEvent): void | Promise<void>;
  /** A slash command fired. Routed to the matching `bot.onCommand` handler (ignored if none). */
  onCommand(cmd: IncomingCommand): void | Promise<void>;
  /** A conversation surface opened. Adapters without the concept never call it. */
  onThreadStarted(evt: IncomingThreadStart): void | Promise<void>;
  /** A reaction was added/removed. Adapters that can't observe reactions never call it. */
  onReaction(evt: IncomingReaction): void | Promise<void>;
  /**
   * A modal was submitted. Returns the handler's result so the adapter can ack
   * with per-field errors (Slack `response_action: "errors"`). Adapters without
   * modals never call it.
   */
  onModalSubmit(evt: IncomingModalSubmit): Promise<ModalSubmitResult | void>;
  /** A modal was dismissed. Adapters without `view_closed` never call it. */
  onModalClose(evt: IncomingModalClose): void | Promise<void>;
}

export interface UserQuery {
  query: string;
}

/** A resolved agent session for a conversation (the adapter may build the agent's history from its own state). */
export interface AgentSession {
  agent: AbstractAgent;
}

/** Adapter-owned conversation state; the adapter resolves (or creates) the agent session for a conversation. */
export interface ConversationStore {
  getOrCreate(
    conversationKey: string,
    replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession>;
}

/**
 * Optional context bot core passes to {@link PlatformAdapter.start}. Carries
 * the bot's declared identity so a transport that must announce itself (e.g.
 * the Intelligence Channel adapter's heartbeat) can do so without separate
 * config. Local adapters ignore it.
 */
export interface AdapterStartContext {
  /** The bot's declared name (`createChannel({ name })`), when set. */
  botName?: string;
}

export interface PlatformAdapter {
  readonly platform: string;
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs: number;
  start(sink: IngressSink, ctx?: AdapterStartContext): Promise<void>;
  stop(): Promise<void>;
  render(ir: BotNode[]): NativePayload;
  post(target: ReplyTarget, ir: BotNode[]): Promise<MessageRef>;
  update(ref: MessageRef, ir: BotNode[]): Promise<void>;
  stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  createRunRenderer(target: ReplyTarget): RunRenderer;
  decodeInteraction(raw: unknown): InteractionEvent | undefined;
  lookupUser(q: UserQuery): Promise<PlatformUser | undefined>;
  readonly conversationStore: ConversationStore;
  /**
   * Optional persistence backend supplied by the adapter. `createChannel` uses it
   * only when no explicit `store.adapter` is configured; if more than one
   * adapter provides one, `createChannel` warns and uses the first. Distinct from
   * {@link conversationStore}.
   */
  readonly stateStore?: StateStore;
  /** @internal Marks the Intelligence Channel adapter for the V1 exclusivity guard. */
  readonly __intelligenceChannel?: boolean;
  /**
   * When true, bot core skips its ingress dedup for events from this adapter.
   * Set by at-least-once transports (Channel delivery) that enforce
   * idempotency at egress instead — dropping a redelivery at ingress would lose
   * a legitimate retry.
   */
  readonly skipIngressDedup?: boolean;
  /**
   * Optional conversation-history read. Backs the capability-gated
   * `Thread.getMessages()`; adapters that can't read history simply omit this,
   * and `Thread.getMessages()` returns `[]`.
   */
  getMessages?(target: ReplyTarget): Promise<ThreadMessage[]>;
  /**
   * Optional platform file upload. Threads expose `postFile` unconditionally;
   * adapters that can't upload simply omit this, and `Thread.postFile` returns
   * a capability-gated `{ ok: false, error }`.
   */
  postFile?(
    target: ReplyTarget,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }>;
  /**
   * Optional slash-command support. Called once on `start()` with the bot's
   * declared commands, so a surface that registers commands up front (e.g.
   * Discord's application-command API) can publish them. Surfaces that match
   * commands dynamically (e.g. Slack, which forwards every `/command` to
   * `sink.onCommand`) need not implement this; adapters that don't support
   * commands at all simply omit it and command handlers never fire there.
   */
  registerCommands?(commands: readonly CommandSpec[]): void | Promise<void>;
  /**
   * Optional: pin suggested prompts on a conversation surface (backs the
   * capability-gated `Thread.setSuggestedPrompts`). Adapters without the
   * concept omit this, and `Thread.setSuggestedPrompts` returns
   * `{ ok: false, error }` without throwing.
   */
  setSuggestedPrompts?(
    target: ReplyTarget,
    prompts: ReadonlyArray<{ title: string; message: string }>,
    opts?: { title?: string },
  ): Promise<{ ok: boolean; error?: string }>;
  /**
   * Optional: set the conversation's display title (backs `Thread.setTitle`).
   * Adapters without the concept omit this, and `Thread.setTitle` returns
   * `{ ok: false, error }` without throwing.
   */
  setThreadTitle?(
    target: ReplyTarget,
    title: string,
  ): Promise<{ ok: boolean; error?: string }>;
  /**
   * Optional reactions egress (backs `Thread.react`/`unreact`). Adapters without
   * reactions omit these; the Thread methods then return `{ ok: false, error }`.
   */
  addReaction?(
    target: ReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }>;
  removeReaction?(
    target: ReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }>;
  /**
   * Optional ephemeral post (backs `Thread.postEphemeral`). The adapter decides
   * native vs DM fallback based on `opts.fallbackToDM` and returns
   * `{ ok, usedFallback }` or `null` (native unsupported and no fallback).
   */
  postEphemeral?(
    target: ReplyTarget,
    user: PlatformUser | string,
    ir: BotNode[],
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null>;
  /** Optional modal render (pure; backs `openModal`). Throws `ModalRenderError` on unsupported elements. */
  renderModal?(ir: BotNode[]): NativePayload;
  /**
   * Optional modal open (backs context `openModal`). Renders `ir` and opens it
   * against the platform `triggerId`. Returns `{ ok: false }` on failure
   * (expired trigger, unsupported elements) — never throws.
   */
  openModal?(
    target: ReplyTarget,
    triggerId: string,
    ir: BotNode[],
  ): Promise<{ ok: boolean; error?: string }>;
}
