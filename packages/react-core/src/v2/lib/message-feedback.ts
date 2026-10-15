import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore } from "@copilotkit/core";

/** Trajectory event name for a rating of one assistant message. */
export const MESSAGE_FEEDBACK_EVENT_NAME = "message.feedback";

/** Longest comment kept, in characters; the rest is cut so the event stays small. */
export const MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH = 1000;

/** Longest excerpt of the rated response sent with the rating, in characters. */
const RESPONSE_EXCERPT_LENGTH = 500;

const STORAGE_PREFIX = "copilotkit:message-feedback:v1:";
// Ratings given while no Trajectory captured, by `feedbackId`. Kept in storage
// so a reload or a new provider still sends them.
const PENDING_KEY = "copilotkit:message-feedback-pending:v1";

export type MessageFeedbackRating = "up" | "down";

/** The rating this browser gave one assistant message. */
export interface MessageFeedback {
  readonly rating: MessageFeedbackRating;
  readonly comment?: string;
}

type ThreadFeedback = Readonly<Record<string, MessageFeedback>>;
type FeedbackEventValue = Record<string, string | null>;

const threads = new Map<string, ThreadFeedback>();
const listeners = new Map<string, Set<() => void>>();
// The waiting ratings as last written; one entry per `feedbackId`, as only
// the newest change matters. Read when storage is blocked or lags behind.
let pendingInMemory: Record<string, FeedbackEventValue> = {};
// Threads whose last save failed, for example on a full quota: storage then
// lags behind memory for them.
const unsavedThreads = new Set<string>();
// False after a write of the waiting list failed, or without storage.
let pendingWritable = true;

/** An empty record whose keys can be any id, also `__proto__`. */
const emptyRecord = <T>(): Record<string, T> => Object.create(null);

const threadKey = (agentId: string, threadId: string) =>
  JSON.stringify([agentId, threadId]);

/** Cuts `text` to `max` characters without splitting a surrogate pair. */
const clip = (text: string, max: number): string => {
  const characters = Array.from(text);
  return characters.length > max ? characters.slice(0, max).join("") : text;
};

/** The comment as saved and sent: trimmed and capped, or none. */
const normalizeComment = (comment: unknown): string | undefined => {
  if (typeof comment !== "string") return undefined;
  const text = clip(comment.trim(), MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH);
  return text === "" ? undefined : text;
};

/** A stored rating read back with the same rules as a new one. */
const parseFeedback = (value: unknown): MessageFeedback | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { rating, comment } = value as Record<string, unknown>;
  if (rating !== "up" && rating !== "down") return undefined;
  const text = normalizeComment(comment);
  return text ? { rating, comment: text } : { rating };
};

const notify = (key: string) => {
  for (const listener of listeners.get(key) ?? []) listener();
};

/**
 * Reads a Thread's saved feedback, or `undefined` when storage is missing or
 * blocked. A record that is not valid JSON reads as empty.
 */
const load = (key: string): ThreadFeedback | undefined => {
  let raw: string | null;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return undefined;
    raw = storage.getItem(STORAGE_PREFIX + key);
  } catch {
    return undefined;
  }
  if (!raw) return emptyRecord();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRecord();
  }
  if (typeof parsed !== "object" || parsed === null) return emptyRecord();
  const feedback = emptyRecord<MessageFeedback>();
  for (const [messageId, value] of Object.entries(parsed)) {
    const entry = parseFeedback(value);
    if (entry) feedback[messageId] = entry;
  }
  return feedback;
};

const save = (key: string, feedback: ThreadFeedback) => {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (Object.keys(feedback).length === 0)
      storage.removeItem(STORAGE_PREFIX + key);
    else storage.setItem(STORAGE_PREFIX + key, JSON.stringify(feedback));
    unsavedThreads.delete(key);
  } catch {
    // The rating still reaches the Trajectory; only the local copy is lost.
    unsavedThreads.add(key);
  }
};

let watchingOtherTabs = false;
/** Rereads a Thread's feedback when another tab of this app changes it. */
const watchOtherTabs = () => {
  if (watchingOtherTabs || typeof globalThis.addEventListener !== "function")
    return;
  watchingOtherTabs = true;
  globalThis.addEventListener("storage", (event: StorageEvent) => {
    try {
      if (event.storageArea && event.storageArea !== globalThis.localStorage)
        return;
    } catch {
      return;
    }
    // A Thread whose save failed keeps its newer copy in memory.
    if (event.key === null) {
      const keys = [...threads.keys()].filter(
        (key) => !unsavedThreads.has(key),
      );
      keys.forEach((key) => threads.delete(key));
      keys.forEach(notify);
      return;
    }
    if (!event.key.startsWith(STORAGE_PREFIX)) return;
    const key = event.key.slice(STORAGE_PREFIX.length);
    if (unsavedThreads.has(key)) return;
    threads.delete(key);
    notify(key);
  });
};

const threadFeedback = (key: string): ThreadFeedback => {
  let feedback = threads.get(key);
  if (feedback === undefined) {
    feedback = load(key) ?? emptyRecord();
    threads.set(key, feedback);
  }
  return feedback;
};

/** Waiting ratings in storage, also from an earlier page load. */
const readStoredPending = (): Record<string, FeedbackEventValue> => {
  try {
    const raw = globalThis.localStorage?.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const valid = emptyRecord<FeedbackEventValue>();
    if (typeof parsed !== "object" || parsed === null) return valid;
    for (const [feedbackId, value] of Object.entries(parsed))
      if (
        typeof value === "object" &&
        value !== null &&
        (value as FeedbackEventValue)["feedbackId"] === feedbackId
      )
        valid[feedbackId] = value as FeedbackEventValue;
    return valid;
  } catch {
    return emptyRecord();
  }
};

/**
 * Waiting ratings. Storage is shared with other tabs and holds the truth
 * while writes work; after a failed write, memory adds what storage missed.
 */
const readPending = (): Record<string, FeedbackEventValue> =>
  pendingWritable
    ? readStoredPending()
    : { ...readStoredPending(), ...pendingInMemory };

const writePending = (next: Record<string, FeedbackEventValue>) => {
  pendingInMemory = next;
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      pendingWritable = false;
      return;
    }
    if (Object.keys(next).length === 0) storage.removeItem(PENDING_KEY);
    else storage.setItem(PENDING_KEY, JSON.stringify(next));
    pendingWritable = true;
  } catch {
    // Kept in memory until this page captures again.
    pendingWritable = false;
  }
};

/** The feedback this browser saved for one message, if any. */
export function getMessageFeedback(
  agentId: string,
  threadId: string,
  messageId: string,
): MessageFeedback | undefined {
  const feedback = threadFeedback(threadKey(agentId, threadId));
  return Object.prototype.hasOwnProperty.call(feedback, messageId)
    ? feedback[messageId]
    : undefined;
}

/** Calls `listener` whenever feedback in this Thread changes, in any tab. */
export function subscribeToMessageFeedback(
  agentId: string,
  threadId: string,
  listener: () => void,
): () => void {
  watchOtherTabs();
  const key = threadKey(agentId, threadId);
  let set = listeners.get(key);
  if (set === undefined) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** The chat a waiting rating belongs to. */
export interface MessageFeedbackChat {
  readonly agentId: string;
  readonly threadId: string;
}

/**
 * Sends the newest rating of each message of `chat` that was given while no
 * Trajectory captured, also on an earlier page load, to the Trajectory that
 * captures now. Ratings of other chats keep waiting for their own chat, so
 * they never reach another app's or user's capture. Ratings belong to their
 * Thread, so a later Trajectory may carry them. Call it when capture starts.
 */
export function flushPendingMessageFeedback(
  copilotkit: CopilotKitCore,
  chat: MessageFeedbackChat,
): void {
  if (copilotkit.trajectoryId === null) return;
  const waiting = readPending();
  const sending = Object.values(waiting).filter(
    (value) =>
      value["agentId"] === chat.agentId && value["threadId"] === chat.threadId,
  );
  if (sending.length === 0) return;
  const rest = emptyRecord<FeedbackEventValue>();
  for (const [feedbackId, value] of Object.entries(waiting))
    if (!sending.includes(value)) rest[feedbackId] = value;
  writePending(rest);
  const withText = copilotkit.ɵlearningCapturesAgentText;
  for (const value of sending) {
    // The capture that sends it may drop the reply text, never add it.
    const { response, ...fields } = value;
    copilotkit.emitTrajectoryEvent(
      MESSAGE_FEEDBACK_EVENT_NAME,
      withText && response !== undefined ? { ...fields, response } : fields,
    );
  }
}

/**
 * Saves (or, with `null`, clears) this browser's feedback for one message and
 * sends it to the active Trajectory. Every change is a new event; the newest
 * event for a `feedbackId` is the current one. While no Trajectory captures,
 * for example during a reconnect, the newest change waits in storage and goes
 * out with {@link flushPendingMessageFeedback}, before any newer change.
 */
export function setMessageFeedback(params: {
  copilotkit: CopilotKitCore;
  agentId: string;
  threadId: string;
  message: AssistantMessage;
  feedback: MessageFeedback | null;
}): void {
  const { copilotkit, agentId, threadId, message } = params;
  const comment = normalizeComment(params.feedback?.comment);
  const feedback: MessageFeedback | null = params.feedback && {
    rating: params.feedback.rating,
    ...(comment ? { comment } : {}),
  };

  const key = threadKey(agentId, threadId);
  // Start from storage, which another tab may have changed since the cache,
  // unless a write failed and storage lags behind the cache. Unchanged
  // entries keep their object, so only the changed message re-renders.
  const cached = threadFeedback(key);
  const stored = (unsavedThreads.has(key) ? undefined : load(key)) ?? cached;
  const next = emptyRecord<MessageFeedback>();
  for (const [messageId, entry] of Object.entries(stored)) {
    const known = cached[messageId];
    next[messageId] =
      known &&
      Object.prototype.hasOwnProperty.call(cached, messageId) &&
      known.rating === entry.rating &&
      known.comment === entry.comment
        ? known
        : entry;
  }
  if (feedback) next[message.id] = feedback;
  else delete next[message.id];
  threads.set(key, next);
  save(key, next);
  notify(key);

  const feedbackId = `${threadId}:${message.id}`;
  const runId = copilotkit.getRunIdForMessage(agentId, threadId, message.id);
  const value: FeedbackEventValue = {
    feedbackId,
    threadId,
    messageId: message.id,
    agentId,
    ...(runId ? { runId } : {}),
    rating: feedback?.rating ?? null,
    ...(feedback?.comment ? { comment: feedback.comment } : {}),
    // A custom sink set to omit agent text gets no excerpt of the reply.
    ...(copilotkit.ɵlearningCapturesAgentText
      ? { response: clip(message.content ?? "", RESPONSE_EXCERPT_LENGTH) }
      : {}),
  };
  if (copilotkit.trajectoryId === null) {
    const waiting = { ...readPending() };
    delete waiting[feedbackId];
    writePending({ ...waiting, [feedbackId]: value });
    return;
  }
  flushPendingMessageFeedback(copilotkit, { agentId, threadId });
  copilotkit.emitTrajectoryEvent(MESSAGE_FEEDBACK_EVENT_NAME, value);
}

/** @internal Forgets cached feedback so tests start from storage. */
export function ɵresetMessageFeedbackCache(): void {
  threads.clear();
  pendingInMemory = {};
  unsavedThreads.clear();
  pendingWritable = true;
}
