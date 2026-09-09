import { useCallback, useState } from "react";

/**
 * Generate an RFC 4122 v4 UUID without `crypto.randomUUID`, which is
 * unavailable over plain http (no SecureContext) on Safari / older
 * Firefox. `crypto.getRandomValues` is universally available.
 */
export const newThreadId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Active-thread state for the chat. `threadId` is ALWAYS a defined
 * UUID — never `undefined`. The SDK's agent-thread connect effect bails
 * on `!hasExplicitThreadId`, which leaves `agent.threadId` undefined and
 * makes frontend-tool round-trips lose their anchor (the chat appears to
 * reset after a tool call). Both "select existing" and "start new" keep
 * an explicit id; "start new" simply mints a fresh one.
 */
export interface ThreadSelection {
  threadId: string;
  selectThread: (id: string) => void;
  createThread: () => string;
}

export function useThreadSelection(): ThreadSelection {
  const [threadId, setThreadId] = useState<string>(newThreadId);

  const selectThread = useCallback((id: string) => {
    setThreadId(id);
  }, []);

  const createThread = useCallback((): string => {
    const next = newThreadId();
    setThreadId(next);
    return next;
  }, []);

  return { threadId, selectThread, createThread };
}
