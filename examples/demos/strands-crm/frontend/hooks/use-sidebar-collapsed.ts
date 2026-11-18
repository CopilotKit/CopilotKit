"use client";
import { useCallback, useSyncExternalStore } from "react";

const KEY = "northstar.sidebar.collapsed";

// Module-level subscriber set so every useSidebarCollapsed() instance re-reads
// the snapshot when any of them toggles. localStorage is the source of truth.
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// SSR + first client render: default to expanded. useSyncExternalStore switches
// to getSnapshot after hydration, so a persisted collapsed state applies cleanly
// without a set-state-in-effect or a hydration mismatch.
function getServerSnapshot(): boolean {
  return false;
}

export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(KEY, collapsed ? "0" : "1");
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }, [collapsed]);
  return { collapsed, toggle };
}
