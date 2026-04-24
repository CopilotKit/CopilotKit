import React, {
  createContext,
  useCallback,
  useContext,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import { useShallowStableRef } from "../lib/slots";

// Default labels
export const CopilotChatDefaultLabels = {
  chatInputPlaceholder: "Type a message...",
  chatInputToolbarStartTranscribeButtonLabel: "Transcribe",
  chatInputToolbarCancelTranscribeButtonLabel: "Cancel",
  chatInputToolbarFinishTranscribeButtonLabel: "Finish",
  chatInputToolbarAddButtonLabel: "Add attachments",
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
  chatDisclaimerText:
    "AI can make mistakes. Please verify important information.",
  chatToggleOpenLabel: "Open chat",
  chatToggleCloseLabel: "Close chat",
  modalHeaderTitle: "CopilotKit Chat",
  welcomeMessageText: "How can I help you today?",
};

export type CopilotChatLabels = typeof CopilotChatDefaultLabels;

// Define the full configuration interface
export interface CopilotChatConfigurationValue {
  labels: CopilotChatLabels;
  agentId: string;
  threadId: string;
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  // True when the current threadId was chosen by the caller rather than
  // silently minted inside the provider chain. Consumers that only make
  // sense against a real backend thread (e.g. /connect, suppressing the
  // welcome screen on switch) gate on this instead of `!!threadId`.
  hasExplicitThreadId: boolean;
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
  // Lets internal wrappers (e.g. the v1 CopilotKit bridge, which pipes a
  // ThreadsProvider-minted UUID through as `threadId`) declare that the
  // threadId they are supplying is NOT a caller choice. When omitted, the
  // provider infers explicitness from whether the `threadId` prop itself
  // was supplied.
  hasExplicitThreadId?: boolean;
  isModalDefaultOpen?: boolean;
}

// Provider component
export const CopilotChatConfigurationProvider: React.FC<
  CopilotChatConfigurationProviderProps
> = ({
  children,
  labels,
  agentId,
  threadId,
  hasExplicitThreadId,
  isModalDefaultOpen,
}) => {
  const parentConfig = useContext(CopilotChatConfiguration);

  // Stabilize labels references so that inline objects (new reference on every
  // parent render) don't invalidate mergedLabels and churn the context value.
  // parentConfig?.labels is already stabilized by the parent provider's own
  // useShallowStableRef, so we only need to stabilize the local labels prop.
  const stableLabels = useShallowStableRef(labels);
  const mergedLabels: CopilotChatLabels = useMemo(
    () => ({
      ...CopilotChatDefaultLabels,
      ...parentConfig?.labels,
      ...stableLabels,
    }),
    [stableLabels, parentConfig?.labels],
  );

  const resolvedAgentId = agentId ?? parentConfig?.agentId ?? DEFAULT_AGENT_ID;

  const autoThreadId = useRef<string | null>(null);
  if (!autoThreadId.current) {
    autoThreadId.current = randomUUID();
  }

  const resolvedThreadId = useMemo(() => {
    if (threadId) {
      return threadId;
    }
    if (parentConfig?.threadId) {
      return parentConfig.threadId;
    }
    return autoThreadId.current!;
  }, [threadId, parentConfig?.threadId]);

  // If a caller passed `hasExplicitThreadId`, trust it verbatim (lets the v1
  // bridge mark an auto-minted UUID as non-explicit). Otherwise infer: a
  // threadId supplied as a prop here is by definition a caller choice.
  const ownHasExplicitThreadId =
    hasExplicitThreadId !== undefined ? hasExplicitThreadId : !!threadId;
  const resolvedHasExplicitThreadId =
    ownHasExplicitThreadId || !!parentConfig?.hasExplicitThreadId;

  const resolvedDefaultOpen = isModalDefaultOpen ?? true;

  const [internalModalOpen, setInternalModalOpen] =
    useState<boolean>(resolvedDefaultOpen);

  const hasExplicitDefault = isModalDefaultOpen !== undefined;

  // When this provider owns its modal state, wrap the setter so that changes
  // propagate upward to any ancestor provider. This allows an outer
  // CopilotChatConfigurationProvider (e.g. a user's layout-level provider) to
  // observe open/close events that originate deep in the tree — fixing the
  // "outer hook always returns true" regression (CPK-7152 Behavior B).
  const setAndSync = useCallback(
    (open: boolean) => {
      setInternalModalOpen(open);
      parentConfig?.setModalOpen(open);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parentConfig?.setModalOpen],
  );

  // Sync parent → child: when an ancestor's modal state is changed externally
  // (e.g. the user calls setModalOpen from an outer hook), reflect that change
  // in our own state so the sidebar/popup responds accordingly.
  // Skip the initial mount so that our own isModalDefaultOpen is respected and
  // not immediately overwritten by the parent's current value.
  const isMounted = useRef(false);
  useEffect(() => {
    if (!hasExplicitDefault) return;
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (parentConfig?.isModalOpen === undefined) return;
    setInternalModalOpen(parentConfig.isModalOpen);
  }, [parentConfig?.isModalOpen, hasExplicitDefault]);

  const resolvedIsModalOpen = hasExplicitDefault
    ? internalModalOpen
    : (parentConfig?.isModalOpen ?? internalModalOpen);
  const resolvedSetModalOpen = hasExplicitDefault
    ? setAndSync
    : (parentConfig?.setModalOpen ?? setInternalModalOpen);

  const configurationValue: CopilotChatConfigurationValue = useMemo(
    () => ({
      labels: mergedLabels,
      agentId: resolvedAgentId,
      threadId: resolvedThreadId,
      hasExplicitThreadId: resolvedHasExplicitThreadId,
      isModalOpen: resolvedIsModalOpen,
      setModalOpen: resolvedSetModalOpen,
    }),
    [
      mergedLabels,
      resolvedAgentId,
      resolvedThreadId,
      resolvedHasExplicitThreadId,
      resolvedIsModalOpen,
      resolvedSetModalOpen,
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
