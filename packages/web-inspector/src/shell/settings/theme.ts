import type { PersistedState } from "../../shared/persistence/inspector-state.js";
import type { InspectorColorScheme } from "../contracts.js";

export function getSystemColorScheme(
  matchMedia: typeof window.matchMedia | undefined,
): InspectorColorScheme {
  return matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveColorSchemePreference(
  persisted: PersistedState | null,
  systemColorScheme: InspectorColorScheme,
): { colorScheme: InspectorColorScheme; hasExplicitColorScheme: boolean } {
  const preference = persisted?.colorSchemePreference;
  if (preference === "light" || preference === "dark") {
    return { colorScheme: preference, hasExplicitColorScheme: true };
  }
  return { colorScheme: systemColorScheme, hasExplicitColorScheme: false };
}
