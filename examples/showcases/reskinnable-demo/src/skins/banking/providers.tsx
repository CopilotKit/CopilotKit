"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  AuthContextProvider,
  useAuthContext,
} from "@/skins/banking/components/auth-context";
import { RecordingProvider } from "@/skins/banking/components/recording-context";
import { RecordingVignette } from "@/skins/banking/components/recording-vignette";
import { SandboxDataSync } from "@/skins/banking/sandbox-data-sync";
import { ReportCopilotTools } from "@/skins/banking/components/wow/report-tool";

/**
 * Banking's `RuntimeProviders` — mounted by the shell ABOVE
 * `CopilotKitProvider`. It establishes the auth context so that
 * `useBankingRuntimeProperties` (below) can read the active member and the
 * shell can thread it into the provider's `properties` prop. Auth living above
 * the provider is what makes client identity ordering-INDEPENDENT: the provider
 * owns the property bag from its first commit, rather than a child racing an
 * imperative `setProperties` after mount.
 *
 * `AuthContextProvider` renders null until the roster loads, so the CopilotKit
 * subtree mounts only once the active member is known — the identity is correct
 * from the very first run, not "eventually, if effects fire in the right order".
 */
export function BankingRuntimeProviders({ children }: { children: ReactNode }) {
  return <AuthContextProvider>{children}</AuthContextProvider>;
}

/**
 * Banking's `useRuntimeProperties`. Reads the active member from the auth
 * context (established above by `BankingRuntimeProviders`) and returns the
 * runtime `properties` the shell threads into `CopilotKitProvider`. The shell's
 * `CopilotKitProvider` adds `a2uiCatalogAvailable: true` itself when a catalog
 * is present, so it is deliberately NOT set here. Memoized on the member's
 * role/id so a member switch (and only a member switch) re-scopes the run.
 */
export function useBankingRuntimeProperties(): Record<string, unknown> {
  const { currentUser } = useAuthContext();
  return useMemo(
    () => ({ userRole: currentUser?.role, userId: currentUser?.id }),
    [currentUser?.role, currentUser?.id],
  );
}

/**
 * The banking skin's below-provider stack — `skin.Providers`. Auth is no longer
 * here (it moved up to `BankingRuntimeProviders`); everything below still reads
 * it via `useAuthContext` because that provider is now an ancestor of this one.
 * Order mirrors the old wrapper.tsx: RecordingProvider → SandboxDataSync →
 * ReportCopilotTools → children → RecordingVignette.
 *
 * - RecordingProvider: the teach-mode `isRecording` flag; wraps BOTH the page
 *   content and the chat so every demonstration call site is inside it.
 * - SandboxDataSync: mirrors the live role-filtered ledger into the OGUI sandbox
 *   snapshot (renders null).
 * - ReportCopilotTools: registers the global createReport tool (renders null) —
 *   filed here (inside CopilotKitProvider) so "prep a report" works from any
 *   page. This is exactly why the whole stack can NOT be hoisted above the
 *   provider — it depends on the CopilotKit context.
 * - RecordingVignette: the soft violet canvas-edge glow while a demonstration
 *   records (its `.recording-vignette` CSS lives in the shell's globals.css).
 */
export function BankingProviders({ children }: { children: ReactNode }) {
  return (
    <RecordingProvider>
      <SandboxDataSync />
      <ReportCopilotTools />
      {children}
      <RecordingVignette />
    </RecordingProvider>
  );
}

export default BankingProviders;
