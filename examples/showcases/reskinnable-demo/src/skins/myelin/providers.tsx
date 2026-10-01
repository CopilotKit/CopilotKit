"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { RecordingProvider, RecordingVignette } from "@/shell/teach";
import { MyelinLedgerProvider, useMyelinLedger } from "./data/ledger-context";

/**
 * ABOVE CopilotKitProvider: the ledger, because `useRuntimeProperties` reads
 * the signed-in admin from it — each admin gets their own memory bucket, so
 * Priya's saved conventions are hers and Marcus starts clean.
 */
export function MyelinRuntimeProviders({ children }: { children: ReactNode }) {
  return <MyelinLedgerProvider>{children}</MyelinLedgerProvider>;
}

export function useMyelinRuntimeProperties():
  | Record<string, unknown>
  | undefined {
  const { admin } = useMyelinLedger();
  return useMemo(
    () => ({ userId: admin.id, userRole: admin.title }),
    [admin.id, admin.title],
  );
}

/** BELOW it: the teach-mode recording context and its on-screen vignette. */
export function MyelinProviders({ children }: { children: ReactNode }) {
  return (
    <RecordingProvider>
      {children}
      <RecordingVignette />
    </RecordingProvider>
  );
}
