import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "@copilotkit/shared";
import type { InputContent } from "@copilotkit/shared";

export interface QueuedMessage {
  id: string;
  content: InputContent[];
}

export type MessageQueueDispatchMode = "sequential" | "merged" | "manual";

export interface UseMessageQueueOptions {
  enabled: boolean;
  dispatch: MessageQueueDispatchMode;
  maxSize?: number;
  isRunning: boolean;
  onDrain: (content: InputContent[]) => Promise<void> | void;
}

export interface UseMessageQueueReturn {
  items: QueuedMessage[];
  enqueue: (content: InputContent[]) => void;
  removeAt: (id: string) => void;
  editAt: (id: string, content: InputContent[]) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  clear: () => void;
  sendNow: (id: string) => void;
}

function mergeQueued(items: QueuedMessage[]): InputContent[] {
  const texts: string[] = [];
  const others: InputContent[] = [];
  for (const item of items) {
    for (const part of item.content) {
      if (part.type === "text") texts.push(part.text);
      else others.push(part);
    }
  }
  const merged: InputContent[] = [];
  if (texts.length > 0) merged.push({ type: "text", text: texts.join("\n\n") });
  merged.push(...others);
  return merged;
}

export function useMessageQueue(
  options: UseMessageQueueOptions,
): UseMessageQueueReturn {
  const { enabled, dispatch, isRunning, maxSize, onDrain } = options;
  const [items, setItems] = useState<QueuedMessage[]>([]);

  const onDrainRef = useRef(onDrain);
  onDrainRef.current = onDrain;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const prevIsRunningRef = useRef(isRunning);

  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;

    if (!enabled) return;
    if (!wasRunning) return;
    if (isRunning) return;
    if (itemsRef.current.length === 0) return;

    if (dispatch === "sequential") {
      const [head, ...rest] = itemsRef.current;
      setItems(rest);
      void onDrainRef.current(head.content);
    } else if (dispatch === "merged") {
      const merged = mergeQueued(itemsRef.current);
      setItems([]);
      void onDrainRef.current(merged);
    }
  }, [enabled, dispatch, isRunning]);

  const enqueue = useCallback(
    (content: InputContent[]) => {
      if (!enabled) return;
      setItems((prev) => {
        if (maxSize !== undefined && prev.length >= maxSize) {
          console.warn(
            `[CopilotKit] Message queue at max size (${maxSize}), dropping message`,
          );
          return prev;
        }
        return [...prev, { id: randomUUID(), content }];
      });
    },
    [enabled, maxSize],
  );

  const removeAt = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const editAt = useCallback((id: string, content: InputContent[]) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, content } : item)),
    );
  }, []);

  const moveUp = useCallback((id: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((id: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const sendNow = useCallback((id: string) => {
    const current = itemsRef.current;
    const item = current.find((i) => i.id === id);
    if (!item) return;
    setItems(current.filter((i) => i.id !== id));
    void onDrainRef.current(item.content);
  }, []);

  return {
    items,
    enqueue,
    removeAt,
    editAt,
    moveUp,
    moveDown,
    clear,
    sendNow,
  };
}
