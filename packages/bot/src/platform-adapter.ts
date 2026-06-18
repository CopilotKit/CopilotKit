import type { AgentSubscriber, AbstractAgent } from "@ag-ui/client";
import type {
  AgentContentPart,
  BotNode,
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
  platform: string;
}

export interface InteractionEvent {
  id: string; // opaque minted action id (ck:...)
  conversationKey: string;
  replyTarget: ReplyTarget;
  value?: unknown;
  user?: PlatformUser;
  /** The message the interaction occurred on (the picker), so handlers can update it in place. */
  messageRef?: MessageRef;
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
  platform: string;
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

export interface IngressSink {
  onTurn(turn: IncomingTurn): void | Promise<void>;
  onInteraction(evt: InteractionEvent): void | Promise<void>;
  /** A slash command fired. Routed to the matching `bot.onCommand` handler (ignored if none). */
  onCommand(cmd: IncomingCommand): void | Promise<void>;
  /** A conversation surface opened. Adapters without the concept never call it. */
  onThreadStarted(evt: IncomingThreadStart): void | Promise<void>;
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
}
