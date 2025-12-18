import React, { createContext, useContext, ReactNode, useMemo, useState } from "react";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkitnext/shared";

// Default labels
export const CopilotChatDefaultLabels = {
  chatInputPlaceholder: "Type a message...",
  chatInputToolbarStartTranscribeButtonLabel: "Transcribe",
  chatInputToolbarCancelTranscribeButtonLabel: "Cancel",
  chatInputToolbarFinishTranscribeButtonLabel: "Finish",
  chatInputToolbarAddButtonLabel: "Add photos or files",
  chatInputToolbarToolsButtonLabel: "Tools",
  assistantMessageToolbarCopyCodeLabel: "Copy",
  assistantMessageToolbarCopyCodeCopiedLabel: "Copied",
  assistantMessageToolbarCopyMessageLabel: "Copy",
  assistantMessageToolbarThumbsUpLabel: "Good response",
  assistantMessageToolbarThumbsDownLabel: "Bad response",
  assistantMessageToolbarReadAloudLabel: "Read aloud",
  assistantMessageToolbarRegenerateLabel: "Regenerate",
  userMessageToolbarCopyMessageLabel: "Copy",
  userMessageToolbarEditMessageLabel: "Edit",
  chatDisclaimerText: "AI can make mistakes. Please verify important information.",
  chatToggleOpenLabel: "Open chat",
  chatToggleCloseLabel: "Close chat",
  modalHeaderTitle: "CopilotKit Chat",
};

export type CopilotChatLabels = typeof CopilotChatDefaultLabels;

// Define the full configuration interface
export interface CopilotChatConfigurationValue {
  labels: CopilotChatLabels;
  agentId: string;
  threadId: string;
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  isModalDefaultOpen: boolean;
}

// Create the configuration context
const CopilotChatConfiguration =
  createContext<CopilotChatConfigurationValue | null>(null);

// Provider props interface
export interface CopilotChatConfigurationProviderProps {
  children: ReactNode;
  labels?: Partial<CopilotChatLabels>;
  agentId?: string;
  threadId?: string;
  isModalDefaultOpen?: boolean;
}

// Provider component
export const CopilotChatConfigurationProvider: React.FC<
  CopilotChatConfigurationProviderProps
> = ({ children, labels, agentId, threadId, isModalDefaultOpen }) => {
  const parentConfig = useContext(CopilotChatConfiguration);

  const mergedLabels: CopilotChatLabels = useMemo(
    () => ({
      ...CopilotChatDefaultLabels,
      ...(parentConfig?.labels ?? {}),
      ...(labels ?? {}),
    }),
    [labels, parentConfig?.labels],
  );

  const resolvedAgentId = agentId ?? parentConfig?.agentId ?? DEFAULT_AGENT_ID;

  const resolvedThreadId = useMemo(() => {
    if (threadId) {
      return threadId;
    }
    if (parentConfig?.threadId) {
      return parentConfig.threadId;
    }
    return randomUUID();
  }, [threadId, parentConfig?.threadId]);

  const resolvedDefaultOpen = isModalDefaultOpen ?? parentConfig?.isModalDefaultOpen ?? true;

  const [internalModalOpen, setInternalModalOpen] = useState<boolean>(
    parentConfig?.isModalOpen ?? resolvedDefaultOpen,
  );

  const resolvedIsModalOpen = parentConfig?.isModalOpen ?? internalModalOpen;
  const resolvedSetModalOpen = parentConfig?.setModalOpen ?? setInternalModalOpen;

  const configurationValue: CopilotChatConfigurationValue = useMemo(
    () => ({
      labels: mergedLabels,
      agentId: resolvedAgentId,
      threadId: resolvedThreadId,
      isModalOpen: resolvedIsModalOpen,
      setModalOpen: resolvedSetModalOpen,
      isModalDefaultOpen: resolvedDefaultOpen,
    }),
    [
      mergedLabels,
      resolvedAgentId,
      resolvedThreadId,
      resolvedIsModalOpen,
      resolvedSetModalOpen,
      resolvedDefaultOpen,
    ],
  );

  return (
    <CopilotChatConfiguration.Provider value={configurationValue}>
      {children}
    </CopilotChatConfiguration.Provider>
  );
};

// Hook to use the full configuration
export const useCopilotChatConfiguration =
  (): CopilotChatConfigurationValue | null => {
    const configuration = useContext(CopilotChatConfiguration);
    return configuration;
  };
