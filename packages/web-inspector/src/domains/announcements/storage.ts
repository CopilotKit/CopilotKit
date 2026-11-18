import {
  emptyNotificationState,
  parseNotificationState,
} from "./notifications.js";
import type { NotificationFeed, NotificationState } from "./notifications.js";

// Obsolete pre-cookie state; the cookie and its mirror are migrated below.
const LEGACY_ANNOUNCEMENT_READ_KEY = "cpk:inspector:announcements";
const LEGACY_ANNOUNCEMENT_READ_COOKIE_NAME = "cpk_inspector_announcements";
const LEGACY_ANNOUNCEMENT_READ_MIRROR_KEY = "cpk:inspector:announcement_read";

// Pulse suppression is per browser tab, and stores the announcement timestamp
// rather than a boolean so a newly published announcement can pulse again.
const ANNOUNCEMENT_PULSED_SESSION_KEY = "cpk:inspector:pulsed";

const NOTIFICATION_COOKIE = "cpk_inspector_notifications_v1";
const NOTIFICATION_STORAGE = "cpk:inspector:notifications:v1";
const NOTIFICATION_COOKIE_MAX_LENGTH = 1024;
const LEGACY_ANNOUNCEMENT_ID = "16f7d877-49e3-41c3-9ca6-f951d3d8ba80";

/**
 * Deletes the superseded origin-scoped read state. Safe to call on every
 * startup: nothing writes that key any more, so the value cannot come back.
 */
export function clearLegacyAnnouncementReadState(): void {
  removeLocalStorageItem(LEGACY_ANNOUNCEMENT_READ_KEY);
}

/** The legacy announcement timestamp this tab already pulsed for, if any. */
export function loadAnnouncementPulsedTimestamp(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(ANNOUNCEMENT_PULSED_SESSION_KEY);
  } catch {
    return null;
  }
}

/** Read host-wide acknowledgements from either the new compact cookie or an old full-state cookie. */
function readNotificationAcknowledgements(): Pick<
  NotificationState,
  "readIds" | "suppressedIds"
> {
  try {
    const raw = readCookie(NOTIFICATION_COOKIE);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object") {
        const state = parseNotificationState({
          ...emptyNotificationState(),
          ...value,
        });
        if (state)
          return { readIds: state.readIds, suppressedIds: state.suppressedIds };
      }
    }
  } catch {
    // A blocked or malformed cookie must not disrupt the Inspector.
  }
  return { readIds: [], suppressedIds: [] };
}

/** Load per-origin selection and merge host-wide read and suppressed notices. */
export function loadNotificationState(): NotificationState {
  const raw = readLocalStorageItem(NOTIFICATION_STORAGE);
  let localState = emptyNotificationState();
  if (raw) {
    try {
      localState = parseNotificationState(JSON.parse(raw)) ?? localState;
    } catch {
      // Keep the host acknowledgements when local storage is malformed.
    }
  }
  const host = readNotificationAcknowledgements();
  return {
    ...localState,
    readIds: [...new Set([...localState.readIds, ...host.readIds])],
    suppressedIds: [
      ...new Set([...localState.suppressedIds, ...host.suppressedIds]),
    ],
  };
}

/** Preserve a legacy acknowledgement only for the known announcement entering the new feed. */
export function migrateAnnouncementReadState(
  state: NotificationState,
  feed: NotificationFeed,
): NotificationState {
  for (const raw of [
    readCookie(LEGACY_ANNOUNCEMENT_READ_COOKIE_NAME),
    readLocalStorageItem(LEGACY_ANNOUNCEMENT_READ_MIRROR_KEY),
  ]) {
    if (!raw) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || !("timestamp" in value))
        continue;
      const legacyNotice = feed.notifications.find(
        (notice) =>
          notice.id === LEGACY_ANNOUNCEMENT_ID &&
          notice.publishedAt === value.timestamp,
      );
      if (!legacyNotice) continue;
      const migrated = {
        ...state,
        readIds: [...new Set([...state.readIds, legacyNotice.id])],
        suppressedIds: [...new Set([...state.suppressedIds, legacyNotice.id])],
      };
      saveNotificationState(migrated);
      writeCookie(LEGACY_ANNOUNCEMENT_READ_COOKIE_NAME, "", "Max-Age=0");
      removeLocalStorageItem(LEGACY_ANNOUNCEMENT_READ_MIRROR_KEY);
      return migrated;
    } catch {
      // Malformed legacy data must not disrupt the host app.
    }
  }
  return state;
}

/** Save full state per origin and a bounded host-wide acknowledgement cookie. */
export function saveNotificationState(state: NotificationState): void {
  const host = readNotificationAcknowledgements();
  const merged = {
    ...state,
    readIds: [...new Set([...state.readIds, ...host.readIds])],
    suppressedIds: [
      ...new Set([...state.suppressedIds, ...host.suppressedIds]),
    ],
  };
  writeLocalStorageItem(NOTIFICATION_STORAGE, JSON.stringify(merged));
  const cookieState = {
    schemaVersion: 1,
    readIds: [...merged.readIds],
    suppressedIds: [...merged.suppressedIds],
  };
  let raw = JSON.stringify(cookieState);
  // Limit bytes sent with every localhost request. Full history stays per
  // origin when the host cookie keeps only the newest acknowledgements.
  while (encodeURIComponent(raw).length >= NOTIFICATION_COOKIE_MAX_LENGTH) {
    if (cookieState.readIds.length >= cookieState.suppressedIds.length)
      cookieState.readIds.shift();
    else cookieState.suppressedIds.shift();
    raw = JSON.stringify(cookieState);
  }
  writeCookie(NOTIFICATION_COOKIE, raw, "Max-Age=31536000");
}

/** ID-based pulse state is separate from the legacy announcement timestamp. */
const NOTIFICATION_PULSED_SESSION_KEY = "cpk:inspector:notification-pulsed-id";
const MAX_PULSED_NOTIFICATION_IDS = 100;

function pulsedNotificationIds(raw: string | null): string[] {
  if (!raw) return [];
  // Earlier previews stored one ID directly under this key.
  if (!raw.startsWith("[")) return [raw];
  try {
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveNotificationPulsedId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const ids = pulsedNotificationIds(
      window.sessionStorage.getItem(NOTIFICATION_PULSED_SESSION_KEY),
    );
    if (!ids.includes(id)) ids.push(id);
    window.sessionStorage.setItem(
      NOTIFICATION_PULSED_SESSION_KEY,
      JSON.stringify(ids.slice(-MAX_PULSED_NOTIFICATION_IDS)),
    );
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
    if (current !== null) return pulsedNotificationIds(current).includes(id);
    if (loadAnnouncementPulsedTimestamp() === publishedAt) {
      saveNotificationPulsedId(id);
      return true;
    }
  } catch {
    /* Treat unavailable storage as a fresh tab. */
  }
  return false;
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
    // Sandboxed documents can deny cookie access.
  }
  return null;
}

function writeCookie(name: string, value: string, lifetime: string): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${name}=${encodeURIComponent(
      value,
    )}; Path=/; ${lifetime}; SameSite=Lax`;
  } catch {
    // The localStorage mirror keeps per-origin persistence when cookies fail.
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
    // Persistence failure must not affect the host application.
  }
}

function removeLocalStorageItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Persistence failure must not affect the host application.
  }
}
