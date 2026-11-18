/**
 * Pure parse/serialise for the shell's layout preferences. Kept free of React
 * and of `localStorage` so it is directly unit-testable; the provider owns the
 * side effects.
 */

export type SidebarSide = "left" | "right";

export interface StoredLayoutPreferences {
  sidebarSide: SidebarSide;
  sidebarOpen: boolean;
}

/** Chat docked left and open — today's behaviour, so nothing changes on a fresh profile. */
export const DEFAULT_LAYOUT_PREFERENCES: StoredLayoutPreferences = {
  sidebarSide: "left",
  sidebarOpen: true,
};

export const LAYOUT_PREFERENCES_KEY = "nw-layout-prefs";

/**
 * Tolerant by design: this reads user-writable storage that may hold values
 * from an older build, so every field is validated and anything unrecognised
 * falls back to its default rather than propagating a bad value into layout
 * state. A corrupt entry must never leave the shell unrenderable.
 */
export function parseLayoutPreferences(
  raw: string | null,
): StoredLayoutPreferences {
  if (!raw) return DEFAULT_LAYOUT_PREFERENCES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT_PREFERENCES;
  }

  // `typeof null === "object"`, and a bare JSON string/number parses fine, so
  // both are screened out before any property access.
  if (typeof parsed !== "object" || parsed === null) {
    return DEFAULT_LAYOUT_PREFERENCES;
  }

  const candidate = parsed as Partial<StoredLayoutPreferences>;

  return {
    sidebarSide: candidate.sidebarSide === "right" ? "right" : "left",
    // Only an explicit `false` closes it, so a missing key means open.
    sidebarOpen: candidate.sidebarOpen !== false,
  };
}

export function serializeLayoutPreferences(
  preferences: StoredLayoutPreferences,
): string {
  return JSON.stringify(preferences);
}
