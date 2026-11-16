"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_FRAMEWORK, frameworkById } from "./data";

// The agent framework the reader last chose or visited, so the home page and
// its navbar menus can point at "your" docs. Prototype D only.

const KEY = "cpk-proto-framework";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function read() {
  const v = localStorage.getItem(KEY);
  return v && frameworkById(v) ? v : DEFAULT_FRAMEWORK;
}

export function rememberFramework(id: string) {
  if (localStorage.getItem(KEY) === id) return;
  localStorage.setItem(KEY, id);
  for (const l of listeners) l();
}

export function useLastFramework(): [string, (id: string) => void] {
  const fw = useSyncExternalStore(subscribe, read, () => DEFAULT_FRAMEWORK);
  const set = useCallback((id: string) => rememberFramework(id), []);
  return [fw, set];
}
