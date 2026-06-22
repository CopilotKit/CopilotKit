export interface MessageRef {
  id: string;
  [k: string]: unknown;
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
 * to the agent without a circular dependency — `@copilotkit/bot` depends on
 * `@copilotkit/bot-ui`, not the reverse. Identical in shape to bot-slack's so
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
}
export interface ThreadMessage {
  user?: PlatformUser;
  text: string;
  ts?: string;
  isBot?: boolean;
}
export interface Thread {
  readonly platform: string;
  post(ui: unknown): Promise<MessageRef>;
  update(ref: MessageRef, ui: unknown): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  /**
   * Post a picker and block until an interaction resolves it to the clicked
   * button's `value`. Pass the expected value type, e.g.
   * `awaitChoice<{ confirmed: boolean }>(<Picker/>)`.
   */
  awaitChoice<T = unknown>(ui: unknown): Promise<T>;
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
}
export interface InteractionContext<TValue = unknown> {
  thread: Thread;
  message: IncomingMessage;
  /** The clicked control: its opaque `id` and the `value` it carried (typed as `TValue`). */
  action: { id: string; value?: TValue };
  values: Record<string, unknown>;
  user: PlatformUser;
  platform: string;
}
export type ClickHandler<TValue = unknown> = (
  ctx: InteractionContext<TValue>,
) => void | Promise<void>;
