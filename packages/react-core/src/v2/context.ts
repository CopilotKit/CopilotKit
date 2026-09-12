"use client";

import { createContext, useContext, useEffect, useReducer } from "react";
import { CopilotKitCoreReact } from "./lib/react-core";
import type { CopilotKitCoreReactConfig } from "./lib/react-core";
import type { LicenseContextValue } from "@copilotkit/shared";

// Re-export so headless.ts (and consumers) reference the same type declaration.
export { CopilotKitCoreReact };
export type { CopilotKitCoreReactConfig };

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
      onHeadersChanged: () => {
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

// Provider-level default agent id, published by `<CopilotKitProvider agentId>`.
//
// This is a context of its own rather than a `CopilotChatConfigurationProvider`
// rendered at the root, because that provider also owns a thread: it resolves a
// threadId (minting a UUID when none is given) and the top-most one owns the
// imperative active-thread override. Rendering it around the whole application
// would hand every `<CopilotChat>` the same inherited threadId, so two sibling
// chats would share one transcript. A bare string context carries the agent
// default and nothing else.
//
// It is the LAST fallback before `DEFAULT_AGENT_ID`, so an explicit `agentId`
// argument, a `<CopilotChat agentId>`, and a `<CopilotChatConfigurationProvider
// agentId>` all still win.
export const CopilotKitAgentIdContext = createContext<string | undefined>(
  undefined,
);

export const useDefaultAgentId = (): string | undefined =>
  useContext(CopilotKitAgentIdContext);
