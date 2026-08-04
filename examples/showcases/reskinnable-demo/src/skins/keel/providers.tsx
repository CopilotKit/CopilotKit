"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { RoleProvider, useRole } from "@/skins/keel/role-context";

/**
 * Keel's `RuntimeProviders` — mounted by the shell ABOVE `CopilotKitProvider`.
 * It establishes the active-persona context (`RoleProvider`) so that
 * `useKeelRuntimeProperties` (below) can read the persona and the shell can
 * thread it into the provider's `properties` prop.
 *
 * Why ABOVE, not below: `properties` is a PROP of `CopilotKitProvider`, so its
 * source must already exist when the provider first commits. Mounting the
 * persona context above the provider makes the provider the sole owner of the
 * property bag from render one — no child racing an imperative `setProperties`
 * after mount, which would make the identity "eventually correct if effects
 * fire in the right order" instead of correct from the very first run.
 */
export function KeelRuntimeProviders({ children }: { children: ReactNode }) {
  return <RoleProvider>{children}</RoleProvider>;
}

/**
 * Keel's `useRuntimeProperties`. Reads the active persona (established above by
 * `KeelRuntimeProviders`) and returns the runtime `properties` the shell threads
 * into `CopilotKitProvider`. The shell adds `a2uiCatalogAvailable: true` itself
 * when a catalog is present, so it is deliberately NOT set here. Memoized on the
 * persona's id/role so the object identity is stable across renders and a run
 * re-scopes only when (and only when) the persona actually changes.
 */
export function useKeelRuntimeProperties(): Record<string, unknown> {
  const { persona } = useRole();
  return useMemo(
    () => ({ userRole: persona.role, userId: persona.id }),
    [persona.id, persona.role],
  );
}
