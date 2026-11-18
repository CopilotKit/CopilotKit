"use client";
import { useCallback, useEffect, useState } from "react";

export type Thread = { id: string; title: string; createdAt: number };
const STORAGE_KEY = "oracle-concierge-threads";

/** Title a thread carries until its first user message names it (see ThreadTitler.tsx). */
export const DEFAULT_THREAD_TITLE = "New conversation";

const MAX_TITLE_LEN = 60;

/**
 * Derive a thread title from a user's submitted message text. Collapses
 * whitespace, trims, and truncates to MAX_TITLE_LEN with an ellipsis. Returns
 * null for empty/whitespace-only input (caller leaves the default title).
 */
export function titleFromText(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > MAX_TITLE_LEN
    ? `${clean.slice(0, MAX_TITLE_LEN).trimEnd()}…`
    : clean;
}

function makeThread(title = DEFAULT_THREAD_TITLE): Thread {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, title, createdAt: Date.now() };
}

export function useThreadStore(): {
  ready: boolean;
  threads: Thread[];
  activeThreadId: string;
  newThread: () => void;
  selectThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
} {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [ready, setReady] = useState<boolean>(false);

  // Mount: hydrate from localStorage, seed if empty. We intentionally setState
  // synchronously here — localStorage is client-only, so reading it is deferred to
  // this mount effect (after the SSR-safe empty initial render) to avoid a
  // hydration mismatch. The single extra mount render is the expected hydration cost.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional client-only localStorage hydration on mount */
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      let valid: Thread[] = [];
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          valid = Array.isArray(parsed)
            ? parsed.filter(
                (t): t is Thread =>
                  t != null &&
                  typeof (t as Thread).id === "string" &&
                  typeof (t as Thread).title === "string" &&
                  typeof (t as Thread).createdAt === "number",
              )
            : [];
        }
      } catch (e) {
        console.warn("thread store: failed to parse localStorage", e);
      }

      if (valid.length > 0) {
        setThreads(valid);
        setActiveThreadId(valid[0].id);
      } else {
        const seed = makeThread();
        setThreads([seed]);
        setActiveThreadId(seed.id);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify([seed]));
        } catch (e) {
          console.warn("thread store: failed to write seed to localStorage", e);
        }
      }
    } catch (e) {
      console.warn("thread store init failed", e);
      const seed = makeThread();
      setThreads([seed]);
      setActiveThreadId(seed.id);
    } finally {
      setReady(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist whenever threads change (after ready)
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    } catch (e) {
      console.warn(
        "thread store: failed to persist threads to localStorage",
        e,
      );
    }
  }, [threads, ready]);

  const newThread = useCallback(() => {
    const t = makeThread();
    setThreads((prev) => [t, ...prev]);
    setActiveThreadId(t.id);
  }, []);

  const selectThread = useCallback(
    (id: string) => {
      if (threads.some((t) => t.id === id)) {
        setActiveThreadId(id);
      }
    },
    [threads],
  );

  const renameThread = useCallback((id: string, title: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === id && t.title !== title ? { ...t, title } : t)),
    );
  }, []);

  return {
    ready,
    threads,
    activeThreadId,
    newThread,
    selectThread,
    renameThread,
  };
}
