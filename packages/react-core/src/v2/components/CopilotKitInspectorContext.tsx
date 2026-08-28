"use client";

import * as React from "react";

export type CopilotKitInspectorOpenRequest = {
  messageId: string;
  threadId?: string;
  agentId?: string;
  menu?: "event-snippets";
  snippetId?: string;
};

export type CopilotKitInspectorSaveRequest = {
  threadId?: string;
  agentId?: string;
} & (
  | {
      kind: "text";
      messageId: string;
      content: string;
    }
  | {
      kind: "reasoning";
      messageId: string;
      content: string;
    }
  | {
      kind: "tool-call";
      messageId: string;
      toolCallId: string;
      toolName: string;
      argsJson: string | Record<string, unknown>;
    }
  | {
      kind: "activity";
      messageId: string;
      activityType: string;
      content: unknown;
    }
);

type CopilotKitInspectorContextValue = {
  isInspectorEnabled: boolean;
  openInspector: (request: CopilotKitInspectorOpenRequest) => void;
  saveEventSnippet: (request: CopilotKitInspectorSaveRequest) => Promise<void>;
};

const CopilotKitInspectorContext =
  React.createContext<CopilotKitInspectorContextValue>({
    isInspectorEnabled: false,
    openInspector: () => undefined,
    saveEventSnippet: async () => undefined,
  });

export const CopilotKitInspectorContextProvider =
  CopilotKitInspectorContext.Provider;

export function useCopilotKitInspector(): CopilotKitInspectorContextValue {
  return React.useContext(CopilotKitInspectorContext);
}
