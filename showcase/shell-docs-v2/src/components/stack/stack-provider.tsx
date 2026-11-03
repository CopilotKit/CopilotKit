"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { isServable, type Stack } from "@/lib/stack";

const STORAGE_KEY = "cpk-docs-stack";

// The saved stack lives in localStorage; this store lets React read it
// without a render-then-correct pass, and keeps open tabs in sync.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readSaved(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** On the server nothing is known yet; `undefined` means "not ready". */
function readOnServer(): undefined {
  return undefined;
}

function parse(raw: string | null | undefined): Stack | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw);
    return isServable(stored) ? stored : null;
  } catch {
    // A malformed value means no saved stack; the reader picks again.
    return null;
  }
}

interface StackContextValue {
  /** The reader's stack, or null until they choose one. */
  stack: Stack | null;
  /** False until the saved choice has been read on the client. */
  ready: boolean;
  /** Bumps on every change the reader makes, so blocks can mark updates. */
  revision: number;
  setStack: (stack: Stack) => void;
  /** Stack-specific blocks on the current page, for the page summary. */
  blocks: number;
  registerBlock: () => () => void;
}

const StackContext = createContext<StackContextValue | null>(null);

export function StackProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readSaved, readOnServer);
  const stack = useMemo(() => parse(raw), [raw]);
  const [revision, setRevision] = useState(0);
  const [blocks, setBlocks] = useState(0);

  const setStack = useCallback((next: Stack) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setRevision((r) => r + 1);
    for (const listener of listeners) listener();
  }, []);

  const registerBlock = useCallback(() => {
    setBlocks((n) => n + 1);
    return () => setBlocks((n) => n - 1);
  }, []);

  const value = useMemo(
    () => ({
      stack,
      ready: raw !== undefined,
      revision,
      setStack,
      blocks,
      registerBlock,
    }),
    [stack, raw, revision, setStack, blocks, registerBlock],
  );

  return <StackContext value={value}>{children}</StackContext>;
}

export function useStack(): StackContextValue {
  const value = useContext(StackContext);
  if (!value) throw new Error("useStack must be used inside <StackProvider>");
  return value;
}
