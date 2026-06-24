import type { Anchor, DockMode, Position, Size } from "./types.js";

export type PersistedContextState = {
  anchor?: Anchor;
  anchorOffset?: Position;
  size?: Size;
  hasCustomPosition?: boolean;
};

export type PersistedState = {
  button?: Omit<PersistedContextState, "size">;
  window?: PersistedContextState;
  isOpen?: boolean;
  dockMode?: DockMode;
  selectedMenu?: string;
  selectedContext?: string;
};

export function loadInspectorState(storageKey: string): PersistedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as PersistedState;
      }
    } catch {
      // Fall through to cookie migration path
    }
  }

  // Backwards compatibility: try to read the legacy cookie and migrate it
  if (typeof document !== "undefined") {
    const prefix = `${storageKey}=`;
    const entry = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(prefix));
    if (entry) {
      const legacyRaw = entry.substring(prefix.length);
      try {
        const parsed = JSON.parse(decodeURIComponent(legacyRaw));
        if (parsed && typeof parsed === "object") {
          return parsed as PersistedState;
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function saveInspectorState(
  storageKey: string,
  state: PersistedState,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist inspector state", error);
  }
}

export function isValidAnchor(value: unknown): value is Anchor {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Anchor;
  return (
    (candidate.horizontal === "left" || candidate.horizontal === "right") &&
    (candidate.vertical === "top" || candidate.vertical === "bottom")
  );
}

export function isValidPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Position;
  return isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y);
}

export function isValidSize(value: unknown): value is Size {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Size;
  return isFiniteNumber(candidate.width) && isFiniteNumber(candidate.height);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidDockMode(value: unknown): value is DockMode {
  return value === "floating" || value === "docked-left";
}

// Telemetry persistence — flat per-key localStorage rather than the
// JSON-blob shape used for window/dock state, because each value is
// independent and we want to read/write them without round-tripping
// the whole inspector state object.
const TELEMETRY_DISTINCT_ID_KEY = "cpk:inspector:telemetry:distinct_id";
const TELEMETRY_OPT_OUT_KEY = "cpk:inspector:telemetry:opt_out";
const TELEMETRY_DISCLOSURE_SHOWN_KEY =
  "cpk:inspector:telemetry:disclosure_shown";

// Module-level fallback for when localStorage is unavailable (private mode,
// quota exceeded, etc.). Cached so that banner_viewed and banner_clicked from
// the same page-load share one distinct_id even without persistent storage —
// funnel coherence within a session is preserved even when storage fails.
let inMemoryFallbackId: string | null = null;

export function getOrCreateTelemetryDistinctId(): string {
  if (typeof window === "undefined") {
    // SSR / test fallback. A non-persistent ID is preferable to throwing
    // because telemetry must never break the host application.
    return generateUuidV4();
  }

  try {
    const existing = window.localStorage.getItem(TELEMETRY_DISTINCT_ID_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = generateUuidV4();
    window.localStorage.setItem(TELEMETRY_DISTINCT_ID_KEY, fresh);
    return fresh;
  } catch {
    return (inMemoryFallbackId ??= generateUuidV4());
  }
}

// Test-only reset so the in-memory fallback doesn't leak between test cases.
export function _resetTelemetryPersistenceForTesting(): void {
  inMemoryFallbackId = null;
}

export function isTelemetryOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === "true";
  } catch {
    return false;
  }
}

export function setTelemetryOptOut(optedOut: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (optedOut) {
      window.localStorage.setItem(TELEMETRY_OPT_OUT_KEY, "true");
    } else {
      window.localStorage.removeItem(TELEMETRY_OPT_OUT_KEY);
    }
  } catch {
    // No-op — see getOrCreateTelemetryDistinctId.
  }
}

export function hasTelemetryDisclosureBeenShown(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(TELEMETRY_DISCLOSURE_SHOWN_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function markTelemetryDisclosureShown(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TELEMETRY_DISCLOSURE_SHOWN_KEY, "true");
  } catch {
    // No-op.
  }
}

function generateUuidV4(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older browsers,
  // some test runners). Not cryptographically strong; acceptable because
  // the value is just an anonymous correlation ID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
