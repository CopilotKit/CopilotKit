import {
  emptyNotificationState,
  parseNotificationState,
} from "./notifications.js";
import type { NotificationState } from "./notifications.js";
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
  hasOpenedInspector?: boolean;
  sidebarCollapsed?: boolean;
  /** @deprecated Replaced by colorSchemePreference to distinguish a user choice from the old light default. */
  colorScheme?: "light" | "dark";
  colorSchemePreference?: "light" | "dark";
};

export const HOME_NEWS_READ_STORAGE_KEY = "cpk:inspector:home-news-read";

/** Return story ids the user has already opened or hovered on Home. */
export function loadHomeNewsReadIds(storageKey: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Persist Home news story ids that the user has already seen. */
export function saveHomeNewsReadIds(storageKey: string, ids: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch (error) {
    console.warn("Failed to persist Home news read state", error);
  }
}

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

// Inspector dismissal is intentionally host-scoped rather than origin-scoped.
// A developer who closes the Inspector on localhost:3000 should not see it
// again on localhost:5173 during the same dismissal window. Cookies are shared
// across ports on one host; localStorage is not.
export const INSPECTOR_DISMISSAL_MIRROR_KEY = "cpk:inspector:dismissed_until";
export const INSPECTOR_DISMISSAL_COOKIE_NAME = "cpk_inspector_dismissed_until";
export const INSPECTOR_DISMISSAL_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

type InspectorDismissalPayload = Readonly<{ until: number }>;

/** Return the active host-scoped Inspector dismissal deadline, if any. */
export function loadInspectorDismissedUntil(
  now: number = Date.now(),
): number | null {
  const until =
    parseInspectorDismissalPayload(
      readCookie(INSPECTOR_DISMISSAL_COOKIE_NAME),
    ) ??
    parseInspectorDismissalPayload(
      readLocalStorageItem(INSPECTOR_DISMISSAL_MIRROR_KEY),
    );

  if (until === null) return null;
  if (until <= now) {
    clearInspectorDismissal();
    return null;
  }
  const maximumUntil = now + INSPECTOR_DISMISSAL_MAX_DURATION_MS;
  if (until > maximumUntil) {
    saveInspectorDismissedUntil(maximumUntil, now);
    return maximumUntil;
  }
  return until;
}

/** Persist a dismissal across browser sessions and localhost ports. */
export function saveInspectorDismissedUntil(
  until: number,
  now: number = Date.now(),
): void {
  if (!Number.isFinite(until) || until <= now) {
    clearInspectorDismissal();
    return;
  }

  const boundedUntil = Math.min(
    until,
    now + INSPECTOR_DISMISSAL_MAX_DURATION_MS,
  );
  const payload = JSON.stringify({
    until: boundedUntil,
  } satisfies InspectorDismissalPayload);
  const maxAgeSeconds = Math.max(1, Math.ceil((boundedUntil - now) / 1000));
  writeCookie(
    INSPECTOR_DISMISSAL_COOKIE_NAME,
    payload,
    `Max-Age=${maxAgeSeconds}`,
  );
  writeLocalStorageItem(INSPECTOR_DISMISSAL_MIRROR_KEY, payload);
}

/** Clear both persistence layers, including an expired host cookie. */
export function clearInspectorDismissal(): void {
  writeCookie(INSPECTOR_DISMISSAL_COOKIE_NAME, "", "Max-Age=0");
  removeLocalStorageItem(INSPECTOR_DISMISSAL_MIRROR_KEY);
}

/** Parse a finite deadline from either persistence layer. */
function parseInspectorDismissalPayload(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InspectorDismissalPayload>;
    return typeof parsed.until === "number" && Number.isFinite(parsed.until)
      ? parsed.until
      : null;
  } catch {
    return null;
  }
}

// The superseded key. Every existing user is re-armed exactly once so they
// discover the surface that replaced the announcement bubble, and the key is
// deleted rather than left in place so nothing can fall back to it later.
const LEGACY_ANNOUNCEMENT_READ_KEY = "cpk:inspector:announcements";

// Pulse suppression is per browser tab, and stores the announcement timestamp
// rather than a boolean: a boolean would swallow a newly published
// announcement for the rest of that tab's life, and the feed is fetched once
// per mount with no polling.
const ANNOUNCEMENT_PULSED_SESSION_KEY = "cpk:inspector:pulsed";

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

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    for (const entry of document.cookie.split(";")) {
      const separator = entry.indexOf("=");
      if (separator === -1) continue;
      if (entry.slice(0, separator).trim() !== name) continue;
      return decodeURIComponent(entry.slice(separator + 1).trim());
    }
  } catch {
    // Cookie access throws in sandboxed documents. Callers fall back to their
    // origin-scoped mirror rather than breaking the host app.
  }
  return null;
}

function writeCookie(name: string, value: string, lifetime: string): void {
  if (typeof document === "undefined") return;
  try {
    // No Domain attribute: the cookie belongs to exactly this host, while
    // remaining shared by every port on that host.
    document.cookie = `${name}=${encodeURIComponent(
      value,
    )}; Path=/; ${lifetime}; SameSite=Lax`;
  } catch {
    // The localStorage mirror gives cookie-blocking browsers per-origin
    // persistence, and neither storage layer may break the host app.
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

const NOTIFICATION_COOKIE = "cpk_inspector_notifications_v1";
const NOTIFICATION_STORAGE = "cpk:inspector:notifications:v1";

/** Load host-scoped delivery state, with per-origin fallback when cookies are blocked. */
export function loadNotificationState(): NotificationState {
  for (const raw of [
    readCookie(NOTIFICATION_COOKIE),
    readLocalStorageItem(NOTIFICATION_STORAGE),
  ]) {
    if (!raw) continue;
    try {
      const state = parseNotificationState(JSON.parse(raw));
      if (state) return state;
    } catch {
      /* Try the mirror. */
    }
  }
  return emptyNotificationState();
}

/** Save without dropping acknowledgement history or letting storage errors escape. */
export function saveNotificationState(state: NotificationState): void {
  const raw = JSON.stringify(state);
  writeLocalStorageItem(NOTIFICATION_STORAGE, raw);
  // Leave room for cookie attributes. Oversized history degrades to localStorage,
  // rather than keeping a stale host cookie that would re-arm read notices.
  if (encodeURIComponent(raw).length < 3500)
    writeCookie(NOTIFICATION_COOKIE, raw, "Max-Age=31536000");
  else writeCookie(NOTIFICATION_COOKIE, "", "Max-Age=0");
}

/** ID-based pulse state is separate from the legacy announcement timestamp. */
const NOTIFICATION_PULSED_SESSION_KEY = "cpk:inspector:notification-pulsed-id";
export function saveNotificationPulsedId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(NOTIFICATION_PULSED_SESSION_KEY, id);
  } catch {
    /* A lost suppression must not disrupt the host. */
  }
}
export function hasNotificationPulsed(
  id: string,
  publishedAt: string,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const current = window.sessionStorage.getItem(
      NOTIFICATION_PULSED_SESSION_KEY,
    );
    if (current !== null) return current === id;
    if (loadAnnouncementPulsedTimestamp() === publishedAt) {
      saveNotificationPulsedId(id);
      return true;
    }
  } catch {
    /* Treat unavailable storage as a fresh tab. */
  }
  return false;
}
