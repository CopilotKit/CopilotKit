import type { Message } from "@copilotkit/shared";
import { useSyncExternalStore } from "react";

type TimestampValue = Date | number | string;

type TimestampedMessage = Message & {
  createdAt?: TimestampValue;
  timestamp?: TimestampValue;
};

export type CopilotChatTimestampFormatter = (
  timestamp: Date,
  message: Message,
) => string;

// Keep locale-dependent text out of the server snapshot, then reveal it after hydration.
const subscribeToClient = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function parseTimestamp(value: TimestampValue | undefined): Date | null {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const date = new Date(
      Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value,
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = value.trim();
  if (!normalized) return null;

  const numericValue = Number(normalized);
  const date =
    Number.isFinite(numericValue) && /^[+-]?\d+(?:\.\d+)?$/.test(normalized)
      ? parseTimestamp(numericValue)
      : new Date(normalized);

  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function getMessageTimestamp(message: Message | undefined): Date | null {
  if (!message) return null;

  const timestamped = message as TimestampedMessage;
  for (const candidate of [timestamped.createdAt, timestamped.timestamp]) {
    const timestamp = parseTimestamp(candidate);
    if (timestamp) return timestamp;
  }
  return null;
}

export function formatMessageTimestamp(
  timestamp: Date,
  message: Message,
  formatTimestamp?: CopilotChatTimestampFormatter,
): string {
  if (formatTimestamp) {
    return formatTimestamp(timestamp, message);
  }

  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function useMessageTimestamp(
  message: Message | undefined,
  showTimestamp: boolean | undefined,
  formatTimestamp?: CopilotChatTimestampFormatter,
): { timestamp: Date | null; timestampText: string | null } {
  const timestamp = showTimestamp ? getMessageTimestamp(message) : null;
  const isClient = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    timestamp ? getServerSnapshot : getClientSnapshot,
  );
  const timestampText =
    isClient && timestamp && message
      ? formatMessageTimestamp(timestamp, message, formatTimestamp)
      : null;

  return { timestamp, timestampText };
}
