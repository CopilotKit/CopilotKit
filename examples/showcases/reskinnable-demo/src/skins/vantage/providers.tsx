"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { ExecContextProvider, useExecContext } from "./components/exec-context";

/**
 * Mounted by the shell ABOVE CopilotKitProvider. Establishes the exec context
 * so `useVantageRuntimeProperties` can read it and the provider owns the
 * identity from its first commit — rather than a child racing an imperative
 * setProperties after mount.
 */
export function VantageRuntimeProviders({ children }: { children: ReactNode }) {
  return <ExecContextProvider>{children}</ExecContextProvider>;
}

/**
 * Threaded into CopilotKitProvider's `properties` prop by the shell. Memoized
 * on the exec's id/role so only an exec switch re-scopes the run. Does NOT
 * set `a2uiCatalogAvailable` — the shell adds that itself when a catalog exists.
 */
export function useVantageRuntimeProperties(): Record<string, unknown> {
  const { currentExec } = useExecContext();
  return useMemo(
    () => ({ userRole: currentExec.role, userId: currentExec.id }),
    [currentExec.role, currentExec.id],
  );
}

// No `Providers` export (the below-provider stack): Phase 1 has no candidate
// for it — its only use would have been beat 6's recording context, which is
// phase 2. Omitted entirely rather than shipping a pass-through.
