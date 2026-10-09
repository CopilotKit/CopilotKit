"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { RecordingProvider, RecordingVignette } from "@/shell/teach";
import {
  PlannerAuthProvider,
  usePlannerAuth,
} from "./components/planner-auth-context";
import { SandboxDataSync } from "./sandbox-data-sync";

/**
 * Mounted by the shell ABOVE CopilotKitProvider. Establishes the planner auth
 * context so `useLogisticsRuntimeProperties` can read it and the provider owns
 * the identity from its first commit — rather than a child racing an imperative
 * setProperties after mount. PlannerAuthProvider renders null until the roster
 * resolves, so no run is ever scoped to an unknown planner.
 */
export function LogisticsRuntimeProviders({
  children,
}: {
  children: ReactNode;
}) {
  return <PlannerAuthProvider>{children}</PlannerAuthProvider>;
}

/**
 * Threaded into CopilotKitProvider's `properties` prop by the shell. Memoized
 * on the planner's id/role so only a planner switch re-scopes the run. Does NOT
 * set `a2uiCatalogAvailable` — the shell adds that itself when a catalog exists.
 */
export function useLogisticsRuntimeProperties(): Record<string, unknown> {
  const { currentPlanner } = usePlannerAuth();
  return useMemo(
    () => ({ userRole: currentPlanner.role, userId: currentPlanner.id }),
    [currentPlanner.role, currentPlanner.id],
  );
}

/**
 * The below-provider stack — `skin.Providers`. Everything here may consume the
 * CopilotKit context, which is exactly why it cannot be hoisted above the
 * provider.
 *
 * - RecordingProvider (BEAT 6): the teach-mode recorder. It wraps BOTH the app
 *   card and the chat card, because the demonstration happens on the Control
 *   Tower while the card that reads `steps` / `getDemonstratedCode()` lives in
 *   the transcript — a provider mounted around only one of them makes every
 *   `logStep` from the other a silent no-op (`useRecording` returns inert
 *   fallbacks outside a provider; nothing throws, the feed is just empty).
 *   Imported from `@/shell/teach`, never re-implemented: three skins shipped
 *   private copies and they diverged.
 * - SandboxDataSync: mirrors the live ledger into the OGUI snapshot.
 * - RecordingVignette: the canvas-edge glow while a demonstration records. Last,
 *   and a sibling of `children` rather than a wrapper, so it overlays the whole
 *   frame without joining the layout.
 */
export function LogisticsProviders({ children }: { children: ReactNode }) {
  return (
    <RecordingProvider>
      <SandboxDataSync />
      {children}
      <RecordingVignette />
    </RecordingProvider>
  );
}

export default LogisticsProviders;
