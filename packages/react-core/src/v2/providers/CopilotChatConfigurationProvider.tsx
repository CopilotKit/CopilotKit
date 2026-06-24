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

/**
 * Tri-state for the chat surface's modal coordination.
 *
 * - `"none"`   — nothing open (the surface is collapsed/closed).
 * - `"chat"`   — the chat panel is open (the legacy `isModalOpen === true`).
 * - `"threads"`— the thread-list (drawer) panel is open instead of chat.
 *
 * `chat` and `threads` are mutually exclusive so the two side panels never
 * crowd a small screen at once. The legacy boolean `isModalOpen` is derived
 * from this: `modalState !== "none"`.
 */
export type CopilotChatModalState = "none" | "chat" | "threads";

/**
 * Map a tri-state {@link CopilotChatModalState} to the legacy open boolean.
 * Both `chat` and `threads` are considered "open" so existing consumers that
 * only ever asked "is the surface visible?" keep working unchanged.
 */
export function isModalStateOpen(state: CopilotChatModalState): boolean {
  return state !== "none";
}

/**
 * Reconcile a legacy `setModalOpen(boolean)` call into the tri-state.
 *
 * - `setModalOpen(true)` opens the chat panel (`"chat"`).
 * - `setModalOpen(false)` collapses the surface (`"none"`).
 *
 * Opening while already on `"threads"` keeps `"threads"` — a boolean "open"
 * must not silently steal focus away from an intentionally-open thread list.
 */
export function modalStateFromBoolean(
  open: boolean,
  current: CopilotChatModalState,
): CopilotChatModalState {
  if (!open) {
    return "none";
  }
  return current === "none" ? "chat" : current;
}

// Define the full configuration interface
export interface CopilotChatConfigurationValue {
  labels: CopilotChatLabels;
  agentId: string;
  threadId: string;
  /**
   * Tri-state coordination for the chat/threads surface. Prefer this over the
   * derived `isModalOpen` boolean when you need to distinguish the chat panel
   * from the thread-list (drawer) panel.
   */
  modalState: CopilotChatModalState;
  /** Set the tri-state directly (e.g. open the threads panel). */
  setModalState: (state: CopilotChatModalState) => void;
  /**
   * Backward-compatible open flag. `true` whenever the surface is showing
   * either the chat or the threads panel (`modalState !== "none"`).
   */
  isModalOpen: boolean;
  /**
   * Backward-compatible setter. `setModalOpen(true)` opens the chat panel,
   * `setModalOpen(false)` collapses the surface. Internally delegates to
   * {@link setModalState} via {@link modalStateFromBoolean}.
   */
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

  const resolvedThreadId = useMemo(() => {
    if (threadId) {
      return threadId;
    }
    if (parentConfig?.threadId) {
      return parentConfig.threadId;
    }
    return randomUUID();
  }, [threadId, parentConfig?.threadId]);

  // If a caller passed `hasExplicitThreadId`, trust it verbatim (lets the v1
  // bridge mark an auto-minted UUID as non-explicit). Otherwise infer: a
  // threadId supplied as a prop here is by definition a caller choice.
  const ownHasExplicitThreadId =
    hasExplicitThreadId !== undefined ? hasExplicitThreadId : !!threadId;
  const resolvedHasExplicitThreadId =
    ownHasExplicitThreadId || !!parentConfig?.hasExplicitThreadId;

  // The default open boolean maps to the `"chat"` tri-state so that existing
  // callers (and the historical `isModalDefaultOpen` default of `true`) keep
  // opening the chat panel exactly as before.
  const resolvedDefaultOpen = isModalDefaultOpen ?? true;
  const resolvedDefaultState: CopilotChatModalState = resolvedDefaultOpen
    ? "chat"
    : "none";

  const [internalModalState, setInternalModalState] =
    useState<CopilotChatModalState>(resolvedDefaultState);

  const hasExplicitDefault = isModalDefaultOpen !== undefined;

  // When this provider owns its modal state, wrap the setter so that changes
  // propagate upward to any ancestor provider. This allows an outer
  // CopilotChatConfigurationProvider (e.g. a user's layout-level provider) to
  // observe open/close events that originate deep in the tree — fixing the
  // "outer hook always returns true" regression (CPK-7152 Behavior B). The
  // sync now carries the full tri-state so a `threads` transition deep in the
  // tree is observable from an outer hook too.
  const setStateAndSync = useCallback(
    (state: CopilotChatModalState) => {
      setInternalModalState(state);
      parentConfig?.setModalState(state);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parentConfig?.setModalState],
  );

  // Sync parent → child: when an ancestor's modal state is changed externally
  // (e.g. the user calls setModalState/setModalOpen from an outer hook),
  // reflect that change in our own state so the sidebar/popup responds.
  // Skip the initial mount so that our own isModalDefaultOpen is respected and
  // not immediately overwritten by the parent's current value.
  const isMounted = useRef(false);
  useEffect(() => {
    if (!hasExplicitDefault) return;
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (parentConfig?.modalState === undefined) return;
    setInternalModalState(parentConfig.modalState);
  }, [parentConfig?.modalState, hasExplicitDefault]);

  const resolvedModalState: CopilotChatModalState = hasExplicitDefault
    ? internalModalState
    : (parentConfig?.modalState ?? internalModalState);
  const resolvedSetModalState = hasExplicitDefault
    ? setStateAndSync
    : (parentConfig?.setModalState ?? setInternalModalState);

  // Derive the backward-compatible boolean surface from the tri-state. These
  // are stable wrappers so legacy consumers of `isModalOpen`/`setModalOpen`
  // behave exactly as before (open === chat-or-threads visible).
  const resolvedIsModalOpen = isModalStateOpen(resolvedModalState);
  const resolvedSetModalOpen = useCallback(
    (open: boolean) => {
      resolvedSetModalState(modalStateFromBoolean(open, resolvedModalState));
    },
    [resolvedSetModalState, resolvedModalState],
  );

  const configurationValue: CopilotChatConfigurationValue = useMemo(
    () => ({
      labels: mergedLabels,
      agentId: resolvedAgentId,
      threadId: resolvedThreadId,
      hasExplicitThreadId: resolvedHasExplicitThreadId,
      modalState: resolvedModalState,
      setModalState: resolvedSetModalState,
      isModalOpen: resolvedIsModalOpen,
      setModalOpen: resolvedSetModalOpen,
    }),
    [
      mergedLabels,
      resolvedAgentId,
      resolvedThreadId,
      resolvedHasExplicitThreadId,
      resolvedModalState,
      resolvedSetModalState,
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
