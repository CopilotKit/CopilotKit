import type { AgentSubscriber } from "@ag-ui/client";
import type {
  CapturedInterrupt,
  CapturedToolCall,
  RunRenderer,
} from "@copilotkit/channels-core";
import { NotionApiError } from "./client.js";
import type { NotionApiClient } from "./client.js";
import { NOTION_LIMITS } from "./render/budget.js";
import { markdownToRichText, plainTextToRichText } from "./render/rich-text.js";
import type { ReplyTarget } from "./types.js";

/** Appended (as Markdown italics) to a reply that was cut off by an interrupt. */
const INTERRUPTED_SUFFIX = "\n_(interrupted)_";

const DEFAULT_THROTTLE_MS = 1000;

/** Timer functions the renderer uses for throttling. Overridable for tests. */
export type RunRendererTimers = Pick<
  typeof globalThis,
  "setTimeout" | "clearTimeout"
>;

/** Options for {@link createRunRenderer}. */
export interface NotionRunRendererOptions {
  /** Notion client that posts and edits the bot's comments. */
  client: Pick<NotionApiClient, "createComment" | "updateComment">;
  /** Discussion the replies go to. */
  target: ReplyTarget;
  /** Custom-event names treated as interrupts (default `{"on_interrupt"}`). */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Smallest gap between two edits of a streaming comment, in ms
   * (default 1000). Notion allows about 3 requests per second per integration.
   */
  throttleMs?: number;
  /**
   * Called once per run, after the first reply comment is created. The
   * adapter uses it to mark the discussion as joined.
   */
  onFirstReply?: () => void | Promise<void>;
  /** Timer functions (default `globalThis`). */
  timers?: RunRendererTimers;
}

/** Stream state of one AG-UI text message. */
interface MessageState {
  /** All text received for this message. */
  text: string;
  /** Offset in `text` where the current (not frozen) comment starts. */
  start: number;
  /** Id of the current comment, or null until it is created. */
  commentId: string | null;
  /** Text the current comment shows now. */
  posted: string;
  /** TEXT_MESSAGE_END arrived. */
  ended: boolean;
}

/**
 * Create the run renderer for one Notion turn.
 *
 * Every AG-UI text message streams into its own comment in
 * `target.discussionId`: the first content delta creates the comment, later
 * deltas edit it at most once per `throttleMs`, and TEXT_MESSAGE_END writes
 * the final text. A message longer than `NOTION_LIMITS.commentText`
 * continues in a new comment. All Notion calls run one at a time, in order.
 *
 * Tool calls and interrupt custom events are captured for the run loop.
 * A RUN_ERROR posts "⚠️ Agent error: <message>". Notion errors are logged
 * with a "[channels-notion]" prefix and never thrown from subscriber hooks or
 * `markInterrupted()`. `finish()` makes the final delivery of the reply text:
 * when that fails, it logs the error and then rejects with it, so
 * `thread.runAgent()` rejects too.
 *
 * @param options.client Notion client (`createComment`, `updateComment`).
 * @param options.target Discussion that receives the replies.
 * @param options.onFirstReply Called once, after the first reply comment exists.
 * @example
 * const renderer = createRunRenderer({ client, target, onFirstReply: markJoined });
 * await agent.runAgent({}, renderer.subscriber);
 * await renderer.finish?.();
 */
export function createRunRenderer(options: NotionRunRendererOptions) {
  const { client, target } = options;
  const interruptEventNames =
    options.interruptEventNames ?? new Set(["on_interrupt"]);
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const timers = options.timers ?? globalThis;

  const messages = new Map<string, MessageState>();
  const dirty = new Set<MessageState>();
  const capturedToolCalls: CapturedToolCall[] = [];
  let pendingInterrupt: CapturedInterrupt | undefined;
  let aborted = false;
  let repliedOnce = false;
  let queue = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushQueued = false;
  /** The latest failed sync. `finish()` rejects with it when text is left unsent. */
  let syncError: unknown;

  /** Run `task` after every earlier Notion call. Errors are logged, never rethrown. */
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((err: unknown) => logError(err));
    return queue;
  };

  const notifyFirstReply = async () => {
    if (repliedOnce) return;
    repliedOnce = true;
    try {
      await options.onFirstReply?.();
    } catch (err) {
      console.error("[channels-notion] onFirstReply failed:", err);
    }
  };

  /** Bring the comments of one message in line with its text. */
  const sync = async (msg: MessageState) => {
    for (;;) {
      const pending = msg.text.slice(msg.start);
      const overflows = pending.length > NOTION_LIMITS.commentText;
      const body = overflows ? pending.slice(0, breakIndex(pending)) : pending;
      if (!body) return;
      if (msg.commentId === null) {
        const comment = await client.createComment({
          discussionId: target.discussionId,
          richText: markdownToRichText(body),
        });
        msg.commentId = comment.id;
        msg.posted = body;
        await notifyFirstReply();
      } else if (body !== msg.posted) {
        await client.updateComment(msg.commentId, markdownToRichText(body));
        msg.posted = body;
      }
      if (!overflows) return;
      // Freeze the full comment and continue in a new one.
      msg.start += body.length;
      msg.commentId = null;
      msg.posted = "";
    }
  };

  const clearFlushTimer = () => {
    if (flushTimer === undefined) return;
    timers.clearTimeout(flushTimer);
    flushTimer = undefined;
  };

  /** Sync every message with unsent text. Queued at most once at a time. */
  const flushDirty = () => {
    if (flushQueued) return queue;
    flushQueued = true;
    return enqueue(async () => {
      flushQueued = false;
      const pending = Array.from(dirty);
      dirty.clear();
      for (const msg of pending) {
        try {
          await sync(msg);
        } catch (err) {
          // Keep the text: the next flush (or finish) tries again.
          dirty.add(msg);
          syncError = err;
          logError(err);
        }
      }
    });
  };

  const scheduleFlush = (msg: MessageState) => {
    dirty.add(msg);
    if (flushTimer !== undefined) return;
    flushTimer = timers.setTimeout(() => {
      flushTimer = undefined;
      void flushDirty();
    }, throttleMs);
  };

  const messageFor = (messageId: string) => {
    const existing = messages.get(messageId);
    if (existing) return existing;
    const created: MessageState = {
      text: "",
      start: 0,
      commentId: null,
      posted: "",
      ended: false,
    };
    messages.set(messageId, created);
    return created;
  };

  const captureToolCall = (
    toolCallId: string,
    toolCallName: string,
    toolCallArgs: Record<string, unknown>,
  ) => {
    const existing = capturedToolCalls.find((c) => c.toolCallId === toolCallId);
    if (existing) {
      existing.toolCallName = toolCallName;
      existing.toolCallArgs = toolCallArgs;
      return;
    }
    capturedToolCalls.push({ toolCallId, toolCallName, toolCallArgs });
  };

  const subscriber: AgentSubscriber = {
    onTextMessageStartEvent({ event }) {
      if (aborted) return;
      messageFor(event.messageId);
    },
    onTextMessageContentEvent({ event }) {
      if (aborted || !event.delta) return;
      const msg = messageFor(event.messageId);
      if (msg.ended) return;
      const isFirstDelta = msg.text.length === 0;
      msg.text += event.delta;
      if (isFirstDelta) {
        dirty.add(msg);
        void flushDirty();
        return;
      }
      scheduleFlush(msg);
    },
    async onTextMessageEndEvent({ event }) {
      if (aborted) return;
      const msg = messages.get(event.messageId);
      if (!msg || msg.ended) return;
      msg.ended = true;
      dirty.add(msg);
      await flushDirty();
    },
    onToolCallArgsEvent({ event, toolCallName, partialToolCallArgs }) {
      if (aborted) return;
      captureToolCall(event.toolCallId, toolCallName, partialToolCallArgs);
    },
    onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (aborted) return;
      captureToolCall(event.toolCallId, toolCallName, toolCallArgs);
    },
    onCustomEvent({ event }) {
      if (aborted || !interruptEventNames.has(event.name)) return;
      pendingInterrupt = {
        eventName: event.name,
        value: parseInterruptValue(event.value),
      };
    },
    async onRunErrorEvent({ event }) {
      if (aborted) return;
      const text = `⚠️ Agent error: ${event.message || "unknown error"}`;
      await enqueue(async () => {
        await client.createComment({
          discussionId: target.discussionId,
          richText: plainTextToRichText(text),
        });
      });
    },
  };

  return {
    subscriber,
    getCapturedToolCalls: () => capturedToolCalls,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    async markInterrupted() {
      if (aborted) return;
      aborted = true;
      clearFlushTimer();
      const open = Array.from(messages.values());
      for (const msg of open) {
        const isCutOff = !msg.ended && msg.text.length > 0;
        if (!isCutOff) continue;
        msg.text += INTERRUPTED_SUFFIX;
        dirty.add(msg);
      }
      await flushDirty();
      await queue;
    },
    async finish() {
      if (aborted) return;
      clearFlushTimer();
      await flushDirty();
      await queue;
      // A message still dirty after the final flush never reached Notion.
      const isReplyUnsent = dirty.size > 0;
      if (isReplyUnsent) throw syncError;
    },
  } satisfies RunRenderer;
}

/**
 * Where to cut text that is longer than one comment: after the last newline
 * in the window, else after the last space, else at the limit (never inside a
 * surrogate pair).
 */
function breakIndex(text: string) {
  const limit = NOTION_LIMITS.commentText;
  const window = text.slice(0, limit);
  const newline = window.lastIndexOf("\n");
  if (newline >= limit / 4) return newline + 1;
  const space = window.lastIndexOf(" ");
  if (space >= limit / 4) return space + 1;
  const splitsPair = isHighSurrogate(window.charCodeAt(limit - 1));
  return splitsPair ? limit - 1 : limit;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Interrupt values may arrive JSON-encoded; a non-JSON string stays a string. */
function parseInterruptValue(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return value;
  }
}

function logError(err: unknown) {
  const isRateLimited =
    err instanceof NotionApiError && err.retryAfterMs !== undefined;
  if (isRateLimited) {
    console.warn(
      `[channels-notion] rate limited; skipping this update (retry after ${err.retryAfterMs} ms)`,
    );
    return;
  }
  console.error("[channels-notion] Notion comment request failed:", err);
}
