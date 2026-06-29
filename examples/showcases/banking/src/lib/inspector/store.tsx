"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TimelineCard } from "./event-cards";

/** A timeline card once stored — gains a stable id for React keys. */
export type StoredCard = TimelineCard & { id: string };

interface InspectorStoreValue {
  cards: StoredCard[];
  pushCard: (card: TimelineCard) => void;
  clear: () => void;
}

/** Keep the live feed bounded so a long session can't grow unboundedly. */
const MAX_CARDS = 200;

const InspectorStoreContext = createContext<InspectorStoreValue | undefined>(
  undefined,
);

export function InspectorStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cards, setCards] = useState<StoredCard[]>([]);
  // Monotonic id source — avoids Math.random/Date.now and is stable for keys.
  const seq = useRef(0);

  const pushCard = useCallback((card: TimelineCard) => {
    const id = String(++seq.current);
    setCards((prev) => {
      const next = [...prev, { ...card, id }];
      return next.length > MAX_CARDS
        ? next.slice(next.length - MAX_CARDS)
        : next;
    });
  }, []);

  const clear = useCallback(() => setCards([]), []);

  const value = useMemo(
    () => ({ cards, pushCard, clear }),
    [cards, pushCard, clear],
  );

  return (
    <InspectorStoreContext.Provider value={value}>
      {children}
    </InspectorStoreContext.Provider>
  );
}

export function useInspector(): InspectorStoreValue {
  const ctx = useContext(InspectorStoreContext);
  if (!ctx) {
    throw new Error(
      "useInspector must be used within an InspectorStoreProvider",
    );
  }
  return ctx;
}
