import type { AgentSubscriber } from "@ag-ui/client";
import type {
  CapturedInterrupt,
  CapturedToolCall,
  RunRenderer,
} from "@copilotkit/channels-core";
import { GitHubApiError } from "./client.js";
import type { GitHubApiClient, GitHubCommentRef } from "./client.js";
import { GITHUB_LIMITS, truncateText } from "./render/budget.js";
import type { GitHubMessageRef, ReplyTarget } from "./types.js";

const LOG_PREFIX = "[channels-github]";
const INTERRUPTED_SUFFIX = "\n\n_(interrupted)_";
const FENCE = "```";
const FENCE_CLOSER = `\n${FENCE}`;

/**
 * Room kept below the hard comment limit when choosing where a comment ends.
 * It covers the fence closer, a continuation fence opener, and the
 * interrupted suffix.
 */
const CONTINUATION_HEADROOM = 256;
const SOFT_LIMIT = GITHUB_LIMITS.commentBody - CONTINUATION_HEADROOM;

/** Options for {@link createRunRenderer}. */
export interface GitHubRunRendererOptions {
  /** GitHub REST client that posts and edits the reply comments. */
  client: GitHubApiClient;
  /** Where the reply goes. With `reviewCommentId`, replies go in that review thread. */
  target: ReplyTarget;
  /** The comment that started the turn. It gets an `eyes` reaction while the agent writes. */
  triggerCommentRef?: GitHubCommentRef;
  /** Custom-event names treated as interrupts (default `{"on_interrupt"}`). */
  interruptEventNames?: ReadonlySet<string>;
  /** Minimum time between two edits of one comment, in ms (default 1000). */
  throttleMs?: number;
}

/** A {@link RunRenderer} that also reports the comments it posted. */
export interface GitHubRunRenderer extends RunRenderer {
  /** Every comment this renderer created, in posting order. */
  getPostedRefs(): readonly GitHubMessageRef[];
}

interface PostedComment {
  id: number;
  /** The body GitHub has now (the last body that was posted with success). */
  body: string;
}

/** Streaming state of one AG-UI text message. One message can span several comments. */
interface TextStream {
  text: string;
  /** Frozen text offsets where one comment ends and the next one starts. */
  boundaries: number[];
  comments: PostedComment[];
  suffix: string;
  /** True after the first sync was requested. */
  started: boolean;
  /** True after TEXT_MESSAGE_END, finish, or markInterrupted. No more text is taken. */
  ended: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Serializes the client calls of this message so edits never race. */
  chain: Promise<void>;
  /** True while a sync is queued but not started. Newer requests join it. */
  queued: boolean;
  lastSyncAt: number;
  /** Earliest time the next edit may run after a rate-limit error. */
  retryAt: number;
  /** The error of the last sync. A later sync that succeeds clears it. */
  failure: { error: unknown } | undefined;
}

function createTextStream() {
  const stream: TextStream = {
    text: "",
    boundaries: [],
    comments: [],
    suffix: "",
    started: false,
    ended: false,
    timer: undefined,
    chain: Promise.resolve(),
    queued: false,
    lastSyncAt: 0,
    retryAt: 0,
    failure: undefined,
  };
  return stream;
}

/**
 * The opening fence line (with its newline) of the code block still open at
 * the end of `prefix`, or `""` when all fences in `prefix` are closed.
 */
function openFenceLine(prefix: string) {
  const fenceCount = prefix.split(FENCE).length - 1;
  const isInsideFence = fenceCount % 2 === 1;
  if (!isInsideFence) return "";
  const start = prefix.lastIndexOf(FENCE);
  const lineEnd = prefix.indexOf("\n", start);
  const line =
    lineEnd === -1 ? prefix.slice(start) : prefix.slice(start, lineEnd);
  return `${line}\n`;
}

/**
 * Freeze new comment boundaries while the text after the last one is longer
 * than the soft limit. A frozen boundary never moves, so a finished comment
 * never changes again. The cut goes after the last newline in the window,
 * else after the last space, else at the limit.
 */
function freezeBoundaries(stream: TextStream) {
  let lastFrozen = stream.boundaries.at(-1) ?? 0;
  while (stream.text.length - lastFrozen > SOFT_LIMIT) {
    const window = stream.text.slice(lastFrozen, lastFrozen + SOFT_LIMIT);
    let breakAt = window.lastIndexOf("\n");
    if (breakAt < SOFT_LIMIT / 4) breakAt = window.lastIndexOf(" ");
    if (breakAt < 0) breakAt = SOFT_LIMIT - 1;
    lastFrozen += breakAt + 1;
    stream.boundaries.push(lastFrozen);
  }
}

/**
 * The body of each comment of a text message. A frozen comment that ends
 * inside a code block gets a closing fence, and the next comment re-opens
 * the block with the same fence line.
 */
function commentBodies(stream: TextStream) {
  const { text, boundaries } = stream;
  const bodies: string[] = [];
  for (let index = 0; index <= boundaries.length; index++) {
    const start = index === 0 ? 0 : boundaries[index - 1];
    const isFrozen = index < boundaries.length;
    const end = isFrozen ? boundaries[index] : text.length;
    const opener = openFenceLine(text.slice(0, start));
    const closer =
      isFrozen && openFenceLine(text.slice(0, end)) !== "" ? FENCE_CLOSER : "";
    const suffix = isFrozen ? "" : stream.suffix;
    const body = opener + text.slice(start, end) + closer + suffix;
    bodies.push(truncateText(body, GITHUB_LIMITS.commentBody));
  }
  return bodies;
}

/**
 * Create the AG-UI run renderer for one GitHub reply target.
 *
 * Each AG-UI text message streams into its own comment: the first content
 * delta creates the comment, later deltas edit it at most once per
 * `throttleMs`, and TEXT_MESSAGE_END writes the final text. Text longer than
 * a GitHub comment continues in a new comment, with code fences balanced at
 * the cut. Client calls for one message run one at a time, and a queued edit
 * always sends the newest text. A failed edit is logged; a rate-limited edit
 * waits for its `retryAfterMs`. The subscriber hooks never throw. `finish()`
 * rejects with the error when the final write of a text message failed, so
 * the run does not report success for a reply the reader cannot see.
 *
 * The trigger comment gets an `eyes` reaction at the first text message. The
 * reaction is removed in `finish()` and `markInterrupted()`.
 *
 * Tool calls and interrupt custom events are captured for the engine's run
 * loop. RUN_ERROR posts `⚠️ Agent error: <message>`.
 *
 * @param options - Client, reply target, optional trigger comment, interrupt event names, and edit throttle.
 *
 * @example
 * ```ts
 * const renderer = createRunRenderer({ client, target, triggerCommentRef: { kind: "issue", commentId } });
 * await agent.runAgent({}, renderer.subscriber);
 * await renderer.finish?.();
 * ```
 */
export function createRunRenderer(options: GitHubRunRendererOptions) {
  const { client, target, triggerCommentRef } = options;
  const interruptEventNames =
    options.interruptEventNames ?? new Set(["on_interrupt"]);
  const throttleMs = options.throttleMs ?? 1000;
  const refKind = target.reviewCommentId === undefined ? "issue" : "review";

  const streams = new Map<string, TextStream>();
  const postedRefs: GitHubMessageRef[] = [];
  const capturedToolCalls: CapturedToolCall[] = [];
  let pendingInterrupt: CapturedInterrupt | undefined;
  let aborted = false;
  let reactionId: Promise<number | null> | undefined;
  let reactionRemoved = false;

  const createComment = async (body: string) => {
    const reviewCommentId = target.reviewCommentId;
    const comment =
      reviewCommentId === undefined
        ? await client.createIssueComment(target, body)
        : await client.replyToReviewComment(target, reviewCommentId, body);
    postedRefs.push({
      id: comment.id,
      kind: refKind,
      owner: target.owner,
      repo: target.repo,
      issueNumber: target.issueNumber,
    });
    return comment.id;
  };

  const updateComment = async (commentId: number, body: string) => {
    if (target.reviewCommentId === undefined) {
      await client.updateIssueComment(target, commentId, body);
      return;
    }
    await client.updateReviewComment(target, commentId, body);
  };

  const addReaction = () => {
    if (triggerCommentRef === undefined || reactionId !== undefined) return;
    reactionId = client
      .addReaction(target, triggerCommentRef, "eyes")
      .catch((err: unknown) => {
        console.warn(`${LOG_PREFIX} adding the eyes reaction failed:`, err);
        return null;
      });
  };

  const removeReaction = async () => {
    if (triggerCommentRef === undefined || reactionId === undefined) return;
    if (reactionRemoved) return;
    reactionRemoved = true;
    const id = await reactionId;
    if (id === null) return;
    try {
      await client.removeReaction(target, triggerCommentRef, id);
    } catch (err) {
      console.warn(`${LOG_PREFIX} removing the eyes reaction failed:`, err);
    }
  };

  /** Bring the posted comments of `stream` in line with its text. */
  const sync = async (stream: TextStream) => {
    if (stream.text.length === 0) return;
    const bodies = commentBodies(stream);
    try {
      for (const [index, body] of bodies.entries()) {
        const posted = stream.comments[index];
        if (posted === undefined) {
          const id = await createComment(body);
          stream.comments.push({ id, body });
          continue;
        }
        if (posted.body === body) continue;
        await updateComment(posted.id, body);
        posted.body = body;
      }
      stream.failure = undefined;
    } catch (err) {
      console.warn(`${LOG_PREFIX} streaming a reply comment failed:`, err);
      stream.failure = { error: err };
      const retryAfterMs =
        err instanceof GitHubApiError ? err.retryAfterMs : undefined;
      if (retryAfterMs === undefined) return;
      stream.retryAt = Date.now() + retryAfterMs;
      scheduleSync(stream);
    }
  };

  const requestSync = (stream: TextStream) => {
    if (stream.queued) return stream.chain;
    stream.queued = true;
    stream.chain = stream.chain.then(async () => {
      stream.queued = false;
      await sync(stream);
      stream.lastSyncAt = Date.now();
    });
    return stream.chain;
  };

  function scheduleSync(stream: TextStream) {
    if (stream.timer !== undefined) return;
    const now = Date.now();
    const delay = Math.max(
      0,
      stream.lastSyncAt + throttleMs - now,
      stream.retryAt - now,
    );
    stream.timer = setTimeout(() => {
      stream.timer = undefined;
      void requestSync(stream);
    }, delay);
  }

  /** Stop taking text for `stream` and send its final body. */
  const finalize = (stream: TextStream) => {
    stream.ended = true;
    clearTimeout(stream.timer);
    stream.timer = undefined;
    return requestSync(stream);
  };

  const streamOf = (messageId: string) => {
    const existing = streams.get(messageId);
    if (existing !== undefined) return existing;
    const stream = createTextStream();
    streams.set(messageId, stream);
    return stream;
  };

  const captureToolCall = (call: CapturedToolCall) => {
    const existing = capturedToolCalls.find(
      (captured) => captured.toolCallId === call.toolCallId,
    );
    if (existing === undefined) {
      capturedToolCalls.push(call);
      return;
    }
    existing.toolCallName = call.toolCallName;
    existing.toolCallArgs = call.toolCallArgs;
  };

  const settleAll = async () => {
    const chains = Array.from(streams.values(), (stream) => stream.chain);
    await Promise.all(chains);
  };

  const subscriber: AgentSubscriber = {
    onTextMessageStartEvent({ event }) {
      if (aborted) return;
      addReaction();
      streamOf(event.messageId);
    },
    onTextMessageContentEvent({ event }) {
      if (aborted) return;
      const stream = streamOf(event.messageId);
      if (stream.ended) return;
      stream.text += event.delta;
      freezeBoundaries(stream);
      if (stream.started) {
        scheduleSync(stream);
        return;
      }
      stream.started = true;
      void requestSync(stream);
    },
    async onTextMessageEndEvent({ event }) {
      if (aborted) return;
      const stream = streams.get(event.messageId);
      if (stream === undefined || stream.ended) return;
      await finalize(stream);
    },
    onToolCallArgsEvent({ event, toolCallName, partialToolCallArgs }) {
      if (aborted) return;
      captureToolCall({
        toolCallId: event.toolCallId,
        toolCallName,
        toolCallArgs: partialToolCallArgs,
      });
    },
    onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (aborted) return;
      captureToolCall({
        toolCallId: event.toolCallId,
        toolCallName,
        toolCallArgs,
      });
    },
    onCustomEvent({ event }) {
      if (aborted) return;
      if (!interruptEventNames.has(event.name)) return;
      let value: unknown = event.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep the string; the interrupt schema downstream rejects it explicitly.
        }
      }
      pendingInterrupt = { eventName: event.name, value };
    },
    async onRunErrorEvent({ event }) {
      if (aborted) return;
      try {
        await createComment(
          `⚠️ Agent error: ${event.message || "unknown error"}`,
        );
      } catch (err) {
        console.warn(`${LOG_PREFIX} posting the agent error failed:`, err);
      }
    },
  };

  const renderer = {
    subscriber,
    getCapturedToolCalls: () => capturedToolCalls,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    getPostedRefs: () => postedRefs,
    async markInterrupted() {
      if (aborted) return;
      aborted = true;
      const open = Array.from(streams.values()).filter(
        (stream) => !stream.ended && stream.text.length > 0,
      );
      for (const stream of open) {
        stream.suffix = INTERRUPTED_SUFFIX;
        void finalize(stream);
      }
      await settleAll();
      await removeReaction();
    },
    async finish() {
      if (aborted) return;
      const open = Array.from(streams.values()).filter(
        (stream) => !stream.ended,
      );
      for (const stream of open) void finalize(stream);
      await settleAll();
      await removeReaction();
      // sync() logged the error already. A rate-limited final write still
      // retries after its wait, but the reply is not complete now.
      const all = Array.from(streams.values());
      for (const stream of all) {
        if (stream.failure !== undefined) throw stream.failure.error;
      }
    },
  } satisfies GitHubRunRenderer;
  return renderer;
}
