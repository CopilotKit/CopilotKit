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

// Announcement read state — "have I read this announcement" is a property of
// the person, not of the project, so it must survive a change of localhost
// port. localStorage cannot express that: it is partitioned by origin and
// origin includes the port, so :3000 and :5173 are separate stores. Cookies
// are partitioned by host, so a cookie set on `localhost` without a `domain`
// attribute is shared by every port on that host.
//
// Underscores, not colons: `:` is a separator in RFC 6265 and is not valid in
// a cookie name. Browsers are lenient about it; we don't rely on that.
const ANNOUNCEMENT_READ_COOKIE_NAME = "cpk_inspector_announcements";

// localStorage mirror of the cookie, so a browser that blocks cookies
// degrades to per-port behaviour instead of losing the read state entirely.
// A NEW key on purpose — the legacy one is abandoned, not migrated.
const ANNOUNCEMENT_READ_MIRROR_KEY = "cpk:inspector:announcement_read";

// The superseded key. Every existing user is re-armed exactly once so they
// discover the surface that replaced the announcement bubble, and the key is
// deleted rather than left in place so nothing can fall back to it later.
const LEGACY_ANNOUNCEMENT_READ_KEY = "cpk:inspector:announcements";

// Pulse suppression is per browser tab, and stores the announcement timestamp
// rather than a boolean: a boolean would swallow a newly published
// announcement for the rest of that tab's life, and the feed is fetched once
// per mount with no polling.
const ANNOUNCEMENT_PULSED_SESSION_KEY = "cpk:inspector:pulsed";

// Roughly one year. No `Secure` — local development is served over plain
// HTTP — and no `HttpOnly`, because the component reads the value from
// script. `Path=/` and `SameSite=Lax` keep it host-wide and same-site only.
const ANNOUNCEMENT_READ_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The announcement timestamp the user has already read, or `null` when
 * nothing has been read yet. Prefers the host-scoped cookie and falls back to
 * the origin-scoped mirror, so cookie-blocking browsers still remember the
 * read within the port they are on.
 */
export function loadAnnouncementReadTimestamp(): string | null {
  return (
    parseTimestampPayload(readAnnouncementCookie()) ??
    parseTimestampPayload(readLocalStorageItem(ANNOUNCEMENT_READ_MIRROR_KEY))
  );
}

/**
 * Records an announcement as read in both the host-scoped cookie and the
 * origin-scoped mirror. The stored value is `{"timestamp":"…"}` — the same
 * shape the announcement state has always used.
 */
export function saveAnnouncementReadTimestamp(timestamp: string): void {
  const payload = JSON.stringify({ timestamp });
  writeAnnouncementCookie(payload);
  writeLocalStorageItem(ANNOUNCEMENT_READ_MIRROR_KEY, payload);
}

/**
 * Deletes the superseded origin-scoped read state. Safe to call on every
 * startup: nothing writes that key any more, so the value cannot come back.
 */
export function clearLegacyAnnouncementReadState(): void {
  removeLocalStorageItem(LEGACY_ANNOUNCEMENT_READ_KEY);
}

/**
 * The announcement timestamp this browser tab has already pulsed for, or
 * `null` when it hasn't pulsed yet.
 */
export function loadAnnouncementPulsedTimestamp(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(ANNOUNCEMENT_PULSED_SESSION_KEY);
  } catch {
    return null;
  }
}

/** Suppresses further pulses for this announcement in this browser tab. */
export function saveAnnouncementPulsedTimestamp(timestamp: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ANNOUNCEMENT_PULSED_SESSION_KEY, timestamp);
  } catch {
    // No-op — a lost suppression costs one extra pulse, never correctness.
  }
}

function parseTimestampPayload(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { timestamp?: unknown };
    return typeof parsed?.timestamp === "string" ? parsed.timestamp : null;
  } catch {
    return null;
  }
}

function readAnnouncementCookie(): string | null {
  if (typeof document === "undefined") return null;
  try {
    for (const entry of document.cookie.split(";")) {
      const separator = entry.indexOf("=");
      if (separator === -1) continue;
      if (entry.slice(0, separator).trim() !== ANNOUNCEMENT_READ_COOKIE_NAME) {
        continue;
      }
      return decodeURIComponent(entry.slice(separator + 1).trim());
    }
  } catch {
    // Cookie access throws in sandboxed documents — fall through to the
    // mirror rather than breaking the host app.
  }
  return null;
}

function writeAnnouncementCookie(value: string): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${ANNOUNCEMENT_READ_COOKIE_NAME}=${encodeURIComponent(
      value,
    )}; Path=/; Max-Age=${ANNOUNCEMENT_READ_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } catch {
    // No-op — the mirror below is what a cookie-blocking browser falls back
    // to, and neither may break the host app.
  }
}

function readLocalStorageItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // No-op — see getOrCreateTelemetryDistinctId.
  }
}

function removeLocalStorageItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // No-op.
  }
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
// quota exceeded, etc.). Cached so that whats_new_viewed and
// whats_new_clicked from the same page-load share one distinct_id even
// without persistent storage —
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
