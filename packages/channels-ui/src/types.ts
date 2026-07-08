import type { EmojiValue } from "./emoji.js";
import type { ModalView } from "./modal.js";
import type { Renderable } from "./ir.js";

export interface MessageRef {
  id: string;
  [k: string]: unknown;
}

/** Result of `Thread.postEphemeral`. `usedFallback` is present on success: `false` = native, `true` = DM fallback. */
export interface EphemeralResult {
  ok: boolean;
  usedFallback?: boolean;
  ref?: MessageRef;
  error?: string;
}
export interface PlatformUser {
  id: string;
  name?: string;
  handle?: string;
  email?: string;
}

/** A base64 data source, shared by every binary media part. */
export type MediaDataSource = { type: "data"; value: string; mimeType: string };

/**
 * AG-UI multimodal content parts. Defined here (the lowest shared layer) so
 * platform adapters can carry built multimodal content through the framework
 * to the agent without a circular dependency — `@copilotkit/channels` depends on
 * `@copilotkit/channels-ui`, not the reverse. Identical in shape to bot-slack's so
 * the agent sees the same multimodal input across every adapter.
 *
 * Binary media (image/audio/video/document) is passed straight through as a
 * data part; the agent's model decides what it can actually consume.
 */
export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: MediaDataSource }
  | { type: "audio"; source: MediaDataSource }
  | { type: "video"; source: MediaDataSource }
  | { type: "document"; source: MediaDataSource };

export interface IncomingMessage {
  text: string;
  user: PlatformUser;
  ref: MessageRef;
  platform: string;
  /**
   * Optional multimodal content parts (e.g. inbound image/file attachments)
   * built by the adapter. When present, the app should prefer these over
   * `text` as the agent prompt so the model receives the attachments.
   */
  contentParts?: AgentContentPart[];
  /**
   * Cross-platform identity key resolved by the bot's `identity` resolver, if
   * any. Stable across platforms for the same human (e.g. an email address).
   */
  userKey?: string;
  /**
   * Stable platform event id (managed/Intelligence path), for customer-side
   * idempotency. Omitted by adapters that don't surface one.
   */
  eventId?: string;
  /** Stable per-turn id (managed/Intelligence path). */
  turnId?: string;
  /** Lease/delivery id (managed/Intelligence path). */
  deliveryId?: string;
}
export interface ThreadMessage {
  user?: PlatformUser;
  text: string;
  ts?: string;
  isBot?: boolean;
}
export interface Thread {
  readonly platform: string;
  /**
   * Whether `awaitChoice` blocks synchronously for the click (interactive
   * surfaces) or requires an ack-first post-then-resume flow (managed HTTP loop,
   * where blocking would deadlock). `undefined`/`true` = blocking-capable;
   * `false` = the surface needs the resume flow. The HITL resume flow will gate
   * on this; no code reads it yet (forward-declared for that work).
   */
  readonly supportsBlockingChoice?: boolean;
  post(ui: Renderable): Promise<MessageRef>;
  update(ref: MessageRef, ui: Renderable): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  /**
   * Post a picker and block until an interaction resolves it to the clicked
   * button's `value`. Pass the expected value type, e.g.
   * `awaitChoice<{ confirmed: boolean }>(<Picker/>)`.
   */
  awaitChoice<T = unknown>(ui: Renderable): Promise<T>;
  runAgent(input?: unknown): Promise<MessageRef | undefined>;
  resume(value: unknown): Promise<MessageRef | undefined>;
  stream(src: string | AsyncIterable<string>): Promise<MessageRef>;
  postFile(args: {
    bytes: Uint8Array;
    filename: string;
    title?: string;
    altText?: string;
  }): Promise<{ ok: boolean; fileId?: string; error?: string }>;
  /** Read the conversation's messages (capability-gated; returns `[]` when the adapter can't read history). */
  getMessages(): Promise<ThreadMessage[]>;
  /** Resolve a platform user by a free-form query (capability-gated; returns `undefined` when unsupported). */
  lookupUser(query: string): Promise<PlatformUser | undefined>;
  /** Pin suggested prompts (capability-gated; returns `{ ok: false }` on surfaces without support). */
  setSuggestedPrompts(
    prompts: ReadonlyArray<{ title: string; message: string }>,
    opts?: { title?: string },
  ): Promise<{ ok: boolean; error?: string }>;
  /** Name this conversation (capability-gated; returns `{ ok: false }` on surfaces without support). */
  setTitle(title: string): Promise<{ ok: boolean; error?: string }>;
  /** Add an emoji reaction to a message (capability-gated; `{ ok: false }` on surfaces without support). */
  react(
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }>;
  /** Remove the bot's emoji reaction from a message (capability-gated). */
  unreact(
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }>;
  /**
   * Post a message only `user` can see. `fallbackToDM` is required:
   * `true` → DM the user when native ephemeral is unsupported; `false` →
   * resolve to `null` when native ephemeral is unsupported.
   */
  postEphemeral(
    user: PlatformUser | string,
    ui: Renderable,
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null>;
  /** Record this conversation as subscribed (persisted in state). Proactive delivery to subscribed conversations is not yet wired. */
  subscribe(): Promise<void>;
  /** Remove the subscription for this conversation. */
  unsubscribe(): Promise<void>;
  /** Returns true if this conversation is currently subscribed. */
  isSubscribed(): Promise<boolean>;
  /** Persist arbitrary per-thread state (e.g. workflow step). */
  setState<T>(v: T): Promise<void>;
  /** Read back per-thread state previously written with `setState`. */
  state<T>(): Promise<T | undefined>;
}
export interface InteractionContext<TValue = unknown> {
  thread: Thread;
  message: IncomingMessage;
  /** The clicked control: its opaque `id` and the `value` it carried (typed as `TValue`). */
  action: { id: string; value?: TValue };
  values: Record<string, unknown>;
  user: PlatformUser;
  platform: string;
  /**
   * Open a modal in response to this interaction (capability-gated; requires a
   * platform trigger). Resolves `{ ok: false }` on surfaces without modal
   * support or when the trigger has expired. On Discord, call this **before**
   * any long-running work — the platform trigger expires ~3s after the click.
   */
  openModal?(view: ModalView): Promise<{ ok: boolean; error?: string }>;
}
export type ClickHandler<TValue = unknown> = (
  ctx: InteractionContext<TValue>,
) => void | Promise<void>;

/** The reaction passed to a `<Message onReaction>` handler. */
export interface MessageReaction {
  /** Normalized emoji name when recognized, else the raw platform token. */
  emoji: EmojiValue;
  /** Platform-native emoji token. */
  rawEmoji: string;
  /** `true` = added, `false` = removed. */
  added: boolean;
  /** The reacting user, when the platform reports one. */
  user?: PlatformUser;
  /** Id of the reacted-to message. */
  messageId: string;
  /**
   * The conversation thread — same surface an `onClick` gets via `ctx.thread`.
   * Post new UI (`thread.post`), run the agent (`thread.runAgent`), block on a
   * human choice (`thread.awaitChoice`, HITL), react back, etc.
   */
  thread: Thread;
  /**
   * Ref to the reacted-to message, for swapping its UI in place:
   * `thread.update(reaction.messageRef, <NewUi/>)`.
   */
  messageRef: MessageRef;
}
/**
 * Handler for reactions on a posted message, set via `<Message onReaction>`.
 * Fires for both adds and removes (check `reaction.added`); the first arg is
 * the emoji for the common `(reaction) => reaction === "bug"` shape. The second
 * carries the full reaction including `thread`/`messageRef`, so a handler can
 * post, swap UI, or run a HITL flow exactly like an `onClick`.
 */
export type MessageReactionHandler = (
  emoji: EmojiValue,
  reaction: MessageReaction,
) => void | Promise<void>;
