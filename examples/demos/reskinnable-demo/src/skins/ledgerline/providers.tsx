"use client";

import type { ReactNode } from "react";
import { LedgerProvider } from "./data/client";
import { TrajectoryRecorder } from "./learning/recorder";
import { ToastProvider } from "./components/toast";

/** Below CopilotKitProvider: the expense ledger, the trajectory recorder and the toasts. */
export function LedgerlineProviders({ children }: { children: ReactNode }) {
  return (
    <LedgerProvider>
      <TrajectoryRecorder />
      <ToastProvider>{children}</ToastProvider>
    </LedgerProvider>
  );
}
