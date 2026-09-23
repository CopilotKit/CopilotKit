"use client";

import * as React from "react";

export type CopilotKitInspectorOpenRequest = {
  messageId: string;
  threadId?: string;
  agentId?: string;
};

type CopilotKitInspectorContextValue = {
  /** Explicit provider preference, which takes priority over chat preferences. */
  providerEnableInspector?: boolean;
  isInspectorEnabled: boolean;
  openInspector: (request: CopilotKitInspectorOpenRequest) => void;
};

const CopilotKitInspectorContext =
  React.createContext<CopilotKitInspectorContextValue>({
    isInspectorEnabled: false,
    openInspector: () => undefined,
  });

export const CopilotKitInspectorContextProvider =
  CopilotKitInspectorContext.Provider;

export function useCopilotKitInspector(): CopilotKitInspectorContextValue {
  return React.useContext(CopilotKitInspectorContext);
}
