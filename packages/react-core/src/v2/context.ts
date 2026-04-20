"use client";

import { createContext, useContext, useEffect, useReducer } from "react";
import type { CopilotKitCoreReact } from "./lib/react-core";
import type { LicenseContextValue } from "@copilotkit/shared";

export interface CopilotKitContextValue {
  copilotkit: CopilotKitCoreReact;
  /**
   * Set of tool call IDs currently being executed.
   * This is tracked at the provider level to ensure tool execution events
   * are captured even before child components mount.
   */
  executingToolCallIds: ReadonlySet<string>;
}

export const EMPTY_SET: ReadonlySet<string> = new Set();

export const CopilotKitContext = createContext<CopilotKitContextValue | null>(
  null,
);

export const useCopilotKit = (): CopilotKitContextValue => {
  const context = useContext(CopilotKitContext);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  if (!context) {
    throw new Error("useCopilotKit must be used within CopilotKitProvider");
  }
  useEffect(() => {
    const subscription = context.copilotkit.subscribe({
      onRuntimeConnectionStatusChanged: () => {
        forceUpdate();
      },
    });
    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return context;
};

// License context — shared between web and RN providers.
// Default is permissive (all features allowed) — providers override via createLicenseContextValue.
// Inlined here to avoid a runtime import from @copilotkit/shared, which pulls in
// Node-only deps (jose) that break React Native's Metro bundler.
export const LicenseContext = createContext<LicenseContextValue>({
  status: null,
  license: null,
  checkFeature: () => true,
  getLimit: () => null,
} as LicenseContextValue);

export const useLicenseContext = (): LicenseContextValue =>
  useContext(LicenseContext);
