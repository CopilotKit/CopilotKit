import type { Anchor, DockMode, Position, Size } from "../layout/types.js";

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

// Inspector dismissal is intentionally host-scoped rather than origin-scoped.
// A developer who hides the Inspector on localhost:3000 should not see it
// again on localhost:5173 during the same dismissal window. Cookies are shared
// across ports on one host; localStorage is not.
export const INSPECTOR_DISMISSAL_MIRROR_KEY = "cpk:inspector:dismissed_until";
export const INSPECTOR_DISMISSAL_COOKIE_NAME =
  "cpk_inspector_dismissed_until";
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
    // Callers fall back to their origin-scoped mirror in sandboxed documents.
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
    // Persistence must never break the host application.
  }
}

function removeLocalStorageItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Persistence must never break the host application.
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
