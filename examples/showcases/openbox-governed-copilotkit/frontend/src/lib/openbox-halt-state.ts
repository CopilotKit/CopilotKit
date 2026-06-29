"use client";

const OPENBOX_HALTED_STORAGE_KEY = "openbox-session-halted";
const OPENBOX_HALTED_EVENT = "openbox-session-halted";

declare global {
  interface Window {
    __openBoxDemoLoadedAt?: number;
  }
}

export function initializeOpenBoxHaltState() {
  if (typeof window === "undefined") return;
  window.__openBoxDemoLoadedAt ??= Date.now();
  window.localStorage.removeItem(OPENBOX_HALTED_STORAGE_KEY);
}

export function clearOpenBoxHaltState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(OPENBOX_HALTED_STORAGE_KEY);
}

export function markOpenBoxSessionHalted(haltedAt?: unknown) {
  if (typeof window === "undefined") return;
  if (typeof haltedAt === "string") {
    const haltedAtTime = Date.parse(haltedAt);
    const loadedAt = window.__openBoxDemoLoadedAt ?? Date.now();
    window.__openBoxDemoLoadedAt = loadedAt;
    if (Number.isFinite(haltedAtTime) && haltedAtTime < loadedAt) return;
  }

  window.localStorage.setItem(OPENBOX_HALTED_STORAGE_KEY, "true");
  window.dispatchEvent(new CustomEvent(OPENBOX_HALTED_EVENT));
}

export function onOpenBoxSessionHalted(listener: () => void) {
  window.addEventListener(OPENBOX_HALTED_EVENT, listener);
  return () => window.removeEventListener(OPENBOX_HALTED_EVENT, listener);
}
