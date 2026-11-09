/**
 * Chat message times live on `metadata.timestamp` as Unix epoch milliseconds.
 * That key is open metadata on an AG-UI message, so it round-trips with the
 * message instead of a field the protocol does not define.
 */
export const MESSAGE_TIMESTAMP_METADATA_KEY = "timestamp";

type TimestampCarrier = {
  id?: string;
  metadata?: Record<string, any> | null;
  timestamp?: unknown;
};

/** Locale hour and minute, for example "2:05 PM". */
export function defaultFormatMessageTimestamp(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function metadataRecord(
  metadata: TimestampCarrier["metadata"],
): Record<string, any> | undefined {
  if (
    metadata == null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return undefined;
  }
  return metadata;
}

/**
 * Reads a message time as epoch milliseconds.
 * A usable `metadata.timestamp` wins. A top-level `timestamp` (number or ISO
 * string) is used when metadata has no usable time.
 */
export function readMessageTimestamp(
  message: TimestampCarrier,
): number | undefined {
  const metadata = metadataRecord(message.metadata);
  const fromMetadata = normalizeMessageTimestamp(
    metadata?.[MESSAGE_TIMESTAMP_METADATA_KEY],
  );
  const fromMessage = normalizeMessageTimestamp(
    "timestamp" in message ? message.timestamp : undefined,
  );
  return fromMetadata ?? fromMessage;
}

/**
 * Accepts epoch milliseconds or an ISO-8601 string.
 * Anything else, including `NaN` and non-numeric strings, is ignored.
 */
export function normalizeMessageTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Whether `Date#toISOString` can represent this epoch time.
 * Finite values such as `1e16` still produce an invalid `Date`.
 */
export function isDisplayableMessageTimestamp(timestamp: number): boolean {
  if (!Number.isFinite(timestamp)) return false;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return false;
  try {
    date.toISOString();
    return true;
  } catch {
    return false;
  }
}

/**
 * Cap for text-start times that never meet a message. A later subscriber can
 * drop the snapshot, so this map would otherwise grow for the life of the chat.
 */
export const MAX_PENDING_MESSAGE_TIMESTAMPS = 200;

/**
 * Records a text-start time. Setting an id again refreshes it to the newest
 * position. Past the cap, the oldest id is dropped.
 */
export function rememberPendingMessageTimestamp(
  pending: Map<string, number>,
  messageId: string,
  timestamp: number,
): void {
  if (!messageId || !Number.isFinite(timestamp)) return;
  if (pending.has(messageId)) pending.delete(messageId);
  pending.set(messageId, timestamp);
  while (pending.size > MAX_PENDING_MESSAGE_TIMESTAMPS) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

/**
 * Drops remembered times whose messages are gone.
 * Ids still in `messages` are left as they are.
 *
 * @returns Whether an entry was removed.
 */
export function retainRememberedMessageTimestamps(
  remembered: Map<string, number>,
  messages: readonly { id?: string }[],
): boolean {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.id) ids.add(message.id);
  }
  let changed = false;
  for (const id of remembered.keys()) {
    if (ids.has(id)) continue;
    remembered.delete(id);
    changed = true;
  }
  return changed;
}

/** Returns a copy with `metadata.timestamp` set when the message has none. */
export function withMessageTimestamp<T extends TimestampCarrier>(
  message: T,
  timestamp: number = Date.now(),
): T {
  if (readMessageTimestamp(message) !== undefined) return message;
  if (!Number.isFinite(timestamp)) return message;
  const metadata = metadataRecord(message.metadata) ?? {};
  return {
    ...message,
    metadata: {
      ...metadata,
      [MESSAGE_TIMESTAMP_METADATA_KEY]: timestamp,
    },
  };
}

/**
 * Records start-event times and times already present on messages.
 * Does not write to the messages. Subscriber payloads can be frozen, and
 * mutating them throws even when timestamps are hidden.
 *
 * @returns Whether the remembered map changed.
 */
export function recordMessageTimestamps(
  messages: readonly TimestampCarrier[],
  pending: Map<string, number>,
  remembered: Map<string, number>,
): boolean {
  let changed = false;
  for (const message of messages) {
    if (!message.id) continue;
    const startedAt = pending.get(message.id);
    if (startedAt !== undefined) pending.delete(message.id);

    const next =
      readMessageTimestamp(message) ?? startedAt ?? remembered.get(message.id);
    if (next === undefined || remembered.get(message.id) === next) continue;
    remembered.set(message.id, next);
    changed = true;
  }
  return changed;
}

/**
 * Returns display copies for messages whose time is only in `remembered`.
 * Messages that already have a time, and messages with no remembered time,
 * keep their original reference. The input array is not mutated.
 */
export function messagesWithTimestamps<T extends TimestampCarrier>(
  messages: readonly T[],
  remembered: ReadonlyMap<string, number>,
): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!message.id || readMessageTimestamp(message) !== undefined) {
      return message;
    }
    const timestamp = remembered.get(message.id);
    if (timestamp === undefined || !isDisplayableMessageTimestamp(timestamp)) {
      return message;
    }
    changed = true;
    return withMessageTimestamp(message, timestamp);
  });
  return changed ? next : messages.slice();
}
