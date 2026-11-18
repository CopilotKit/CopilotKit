"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The navbar's Auto-approve switch. When on, the approval card answers
 * every interrupt itself, except pushes, which always ask. Remembered per
 * browser; off by default.
 */

const STORAGE_KEY = "repo-doctor-auto-approve";

/** Tools that always ask, whatever the switch says. */
export const ALWAYS_ASK = new Set(["git_push"]);

const listeners = new Set<() => void>();
let memory: boolean | null = null;

function read(): boolean {
  if (memory !== null) return memory;
  try {
    memory = localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    memory = false;
  }
  return memory;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    memory = event.newValue === "on";
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAutoApprove(): {
  autoApprove: boolean;
  setAutoApprove: (on: boolean) => void;
} {
  const autoApprove = useSyncExternalStore(subscribe, read, () => false);
  const setAutoApprove = useCallback((on: boolean) => {
    memory = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Blocked storage: the choice lasts for this page only.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return { autoApprove, setAutoApprove };
}
