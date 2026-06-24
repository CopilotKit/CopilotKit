import type { AgentSubscriber, AbstractAgent } from "@ag-ui/client";
import type {
  AgentContentPart,
  BotNode,
  EmojiValue,
  EphemeralResult,
  MessageRef,
  PlatformUser,
  ThreadMessage,
} from "@copilotkit/bot-ui";
import type { CommandSpec } from "./commands.js";

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

export interface IncomingTurn {
  conversationKey: string;
  replyTarget: ReplyTarget;
  userText: string;
  /**
   * Optional multimodal content parts built by the adapter (e.g. inbound
   * image/file attachments). Carried through to `IncomingMessage.contentParts`.
   */
  contentParts?: AgentContentPart[];
  user?: PlatformUser;
  /** Stable platform event id for idempotency; omit if the platform provides none. */
  eventId?: string;
  platform: string;
}

export interface InteractionEvent {
  id: string; // opaque minted action id (ck:...)
  conversationKey: string;
  replyTarget: ReplyTarget;
  value?: unknown;
  user?: PlatformUser;
  /** Stable platform event id for idempotency; omit if the platform provides none. */
  eventId?: string;
  /** The message the interaction occurred on (the picker), so handlers can update it in place. */
  messageRef?: MessageRef;
  /** Opaque platform trigger for opening a modal (Slack `trigger_id`; Discord interaction id). */
  triggerId?: string;
}

/** A slash-command invocation normalized by an adapter. */
export interface IncomingCommand {
  /** Command name as invoked (a leading slash and case are normalized by the engine). */
  command: string;
  /** Raw argument string after the command name (the form text-only surfaces deliver). */
  text: string;
  /** Structured, pre-parsed options when the surface delivers them (e.g. Discord). */
  rawOptions?: Record<string, unknown>;
  conversationKey: string;
  replyTarget: ReplyTarget;
  user?: PlatformUser;
  /** Stable platform event id for idempotency; omit if the platform provides none. */
  eventId?: string;
  platform: string;
  /** Opaque platform trigger for opening a modal (Slack `trigger_id`; Discord interaction id). */
  triggerId?: string;
}

/**
 * A "conversation opened" lifecycle event (Slack: `assistant_thread_started`).
 * Adapters without the concept never emit it.
 */
export interface IncomingThreadStart {
  conversationKey: string;
  replyTarget: ReplyTarget;
  user?: PlatformUser;
  platform: string;
}

/** A reaction added/removed on a message. Adapters that can't observe reactions never emit it. */
export interface IncomingReaction {
  /** Platform-native emoji token (Slack shortcode, Unicode, Discord custom). */
  rawEmoji: string;
  /** true = added, false = removed. */
  added: boolean;
  user?: PlatformUser;
  conversationKey: string;
  replyTarget: ReplyTarget;
  /** Id of the reacted-to message. */
  messageId: string;
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

export interface PlatformAdapter {
  readonly platform: string;
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs: number;
  start(sink: IngressSink): Promise<void>;
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
