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
 * `metadata.timestamp` wins. A top-level `timestamp` (number or ISO string)
 * is accepted for messages that already carry one there.
 */
export function readMessageTimestamp(
  message: TimestampCarrier,
): number | undefined {
  const metadata = metadataRecord(message.metadata);
  const fromMetadata = metadata?.[MESSAGE_TIMESTAMP_METADATA_KEY];
  const fromMessage = "timestamp" in message ? message.timestamp : undefined;
  return normalizeMessageTimestamp(fromMetadata ?? fromMessage);
}

export function normalizeMessageTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Writes `metadata.timestamp` onto a live message. An existing time is kept.
 * The agent subscriber types messages as readonly; the store objects are not.
 */
export function stampMessageTimestamp(
  message: TimestampCarrier,
  timestamp: number,
): void {
  if (!Number.isFinite(timestamp)) return;
  if (readMessageTimestamp(message) !== undefined) return;
  const mutable = message as { metadata?: Record<string, any> | null };
  const metadata = metadataRecord(mutable.metadata) ?? {};
  mutable.metadata = {
    ...metadata,
    [MESSAGE_TIMESTAMP_METADATA_KEY]: timestamp,
  };
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
 * Applies start-event times, then fills back a time that a later snapshot
 * dropped. Messages that never had a time stay without one.
 */
export function recordMessageTimestamps(
  messages: readonly TimestampCarrier[],
  pending: Map<string, number>,
  remembered: Map<string, number>,
): void {
  for (const message of messages) {
    if (!message.id) continue;
    const startedAt = pending.get(message.id);
    if (startedAt !== undefined) {
      pending.delete(message.id);
      stampMessageTimestamp(message, startedAt);
    }
    const current = readMessageTimestamp(message);
    if (current !== undefined) {
      remembered.set(message.id, current);
      continue;
    }
    const previous = remembered.get(message.id);
    if (previous !== undefined) {
      stampMessageTimestamp(message, previous);
    }
  }
}
