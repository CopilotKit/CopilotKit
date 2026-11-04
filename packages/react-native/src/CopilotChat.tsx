import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/headless";
import { useCopilotKit } from "@copilotkit/react-core/context";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";
import {
  ɵChatConnection,
  ɵFreshThreadId,
  ɵcreateChatSubmitter,
  ɵsubscribeToAgentErrors,
} from "@copilotkit/core";
import { useAttachments } from "./hooks/use-attachments";
import type { NativeAttachmentsConfig } from "./hooks/use-attachments";
import type { Attachment } from "@copilotkit/shared";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface CopilotChatContextValue {
  /** The resolved agent instance. */
  agent: any;
  /** Whether the agent is currently running. */
  isRunning: boolean;
  /** Current messages in the conversation. */
  messages: any[];
  /** Currently selected attachments (uploading + ready). */
  attachments: Attachment[];
  /** Whether attachments are enabled. */
  attachmentsEnabled: boolean;
  /** Open the native document picker to add files. */
  openPicker: () => Promise<void>;
  /** Remove an attachment by ID. */
  removeAttachment: (id: string) => void;
  /**
   * Submit a message with the ready attachments and run the agent. Waits
   * for the thread's connection and for the run in flight. Blank text, and a
   * send while an attachment uploads, are ignored. Resolves once the run has
   * settled.
   */
  submitMessage: (text: string) => Promise<void>;
}

const CopilotChatCtx = createContext<CopilotChatContextValue | null>(null);

/**
 * Hook to access the CopilotChat context from child components.
 * Must be called inside a `<CopilotChat>` component tree.
 */
export function useCopilotChatContext(): CopilotChatContextValue {
  const ctx = useContext(CopilotChatCtx);
  if (!ctx) {
    throw new Error(
      "useCopilotChatContext must be used within a <CopilotChat> component",
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CopilotChatBaseProps {
  /**
   * The agent ID to use for this chat session.
   * Matches the web SDK's CopilotChat `agentId` prop.
   *
   * Resolution order: `agentId` > `agentName` > the agent of the chat (or
   * `CopilotChatConfigurationProvider`) around this one > `"default"`
   */
  agentId?: string;

  /**
   * @deprecated Use `agentId` instead. `agentName` is kept for backwards
   * compatibility and will be removed in a future release.
   */
  agentName?: string;

  /**
   * Thread ID for this chat session. When provided, the chat restores the
   * thread from the backend and reconnects to a run in progress. Without it,
   * the chat uses the thread of the chat around it, or a new thread. Matches
   * the web SDK's CopilotChat `threadId` prop.
   */
  threadId?: string;

  /**
   * Error handler scoped to this chat's agent. Fires in addition to the
   * provider-level onError (does not suppress it). Receives errors whose
   * context.agentId matches this chat's agent, and errors with no agentId.
   */
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;

  /**
   * Throttle interval (in milliseconds) for re-renders triggered by message
   * change notifications. Overrides the provider-level `defaultThrottleMs`
   * for this chat instance. Forwarded to the internal `useAgent()` hook.
   *
   * @default undefined -- inherits from provider `defaultThrottleMs`;
   * if that is also unset, re-renders are unthrottled.
   */
  throttleMs?: number;

  /**
   * Enable multimodal file attachments (images, audio, video, documents).
   * Pass a NativeAttachmentsConfig object to configure file picking behavior.
   */
  attachments?: NativeAttachmentsConfig;

  /**
   * Optional children rendered inside the chat context.
   */
  children?: ReactNode;
}

export interface CopilotChatProps extends CopilotChatBaseProps {
  /** Passthrough props are forwarded to consumers via the agent context. */
  [key: string]: unknown;
}

/**
 * Headless CopilotChat component for React Native.
 *
 * Wires up the `useAgent` hook with `agentId` resolution and renders children.
 * Unlike the web SDK's CopilotChat, this component does not render any UI
 * elements -- consumers provide their own React Native views.
 *
 * Children can access chat state via `useCopilotChatContext()`.
 *
 * Hooks inside the chat, such as `useAgent` and `useInterrupt`, use this
 * chat's agent when they do not pass an `agentId`. When the chat has a
 * `threadId`, `useAgent` inside the chat sets that thread on each agent it
 * returns, also on an agent that the hook names with its own `agentId`. Only
 * `useAgent({ agentId, runtimeAgentId, threadId })` keeps a different thread.
 *
 * A chat inside another chat uses the outer chat's agent when it has no
 * `agentId`. When the outer chat has a `threadId` and the inner chat does not,
 * the inner chat uses the outer thread. The web `CopilotChat` does the same.
 *
 * ```tsx
 * import { CopilotChat, useCopilotChatContext } from "@copilotkit/react-native";
 *
 * function MyChatUI() {
 *   const { messages, submitMessage, attachments, openPicker } = useCopilotChatContext();
 *   // ... render your UI
 * }
 *
 * <CopilotChat agentId="my-agent" attachments={{ enabled: true }}>
 *   <MyChatUI />
 * </CopilotChat>
 * ```
 */
export function CopilotChat({
  agentId,
  agentName,
  threadId,
  onError,
  throttleMs,
  attachments: attachmentsConfig,
  children,
  ..._rest
}: CopilotChatProps) {
  // Same precedence as the web CopilotChat: a chat that names no agent takes
  // the agent of the chat configuration around it before "default".
  const chatConfig = useCopilotChatConfiguration();
  const resolvedAgentId =
    agentId ?? agentName ?? chatConfig?.agentId ?? DEFAULT_AGENT_ID;

  // Deprecation warning (dev only, fires once per mount)
  const warnedRef = useRef(false);
  useEffect(() => {
    if (
      agentName !== undefined &&
      agentId === undefined &&
      !warnedRef.current
    ) {
      warnedRef.current = true;
      if (typeof __DEV__ === "undefined" || __DEV__) {
        console.warn(
          "[CopilotKit] agentName is deprecated, use agentId instead",
        );
      }
    }
  }, [agentName, agentId]);

  // Same thread rules as the web CopilotChat: the `threadId` prop, else the
  // thread of the chat around this one, else a UUID minted for this chat.
  // Only a thread a caller picked is "explicit" and restored from the backend.
  const providedThreadId = threadId ?? chatConfig?.threadId;
  const [freshThreadId] = useState(() => new ɵFreshThreadId());
  const resolvedThreadId = useMemo(
    () => freshThreadId.resolve(providedThreadId),
    [freshThreadId, providedThreadId],
  );
  const hasExplicitThreadId = !!threadId || !!chatConfig?.hasExplicitThreadId;

  const { agent } = useAgent({ agentId: resolvedAgentId, throttleMs });
  const { copilotkit } = useCopilotKit();

  // Keeps the agent on the thread this chat shows, restores a picked thread
  // with a connect, and empties the agent on a switch to a fresh thread. Core
  // owns the connect's abort and detach, as in the web chats.
  const [connection] = useState(
    () => new ɵChatConnection({ core: copilotkit }),
  );
  const { threads } = connection;
  useEffect(() => {
    const handle = connection.open({
      agent,
      threadId: resolvedThreadId,
      explicit: hasExplicitThreadId,
    });
    return () => handle.release();
  }, [connection, agent, resolvedThreadId, hasExplicitThreadId]);

  // onError subscription -- forward core errors scoped to this chat's agent
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!onErrorRef.current) return;
    return ɵsubscribeToAgentErrors(copilotkit, resolvedAgentId, (event) =>
      onErrorRef.current?.(event),
    );
  }, [copilotkit, resolvedAgentId]);

  // Attachments
  const {
    attachments: selectedAttachments,
    enabled: attachmentsEnabled,
    openPicker,
    removeAttachment,
    consumeAttachments,
  } = useAttachments({ config: attachmentsConfig });
  // A send waits for the run in flight, so the submitter re-checks the
  // upload guard against the latest attachments, not this render's.
  const attachmentsRef = useRef(selectedAttachments);
  useLayoutEffect(() => {
    attachmentsRef.current = selectedAttachments;
  });

  // The send side lives in core: the upload guard, the message content, and
  // waiting for the thread's connection and the run in flight.
  const agentRef = useRef(agent);
  useLayoutEffect(() => {
    agentRef.current = agent;
  });
  const [submitter] = useState(() =>
    ɵcreateChatSubmitter({
      core: copilotkit,
      getAgent: () => agentRef.current,
      // This chat renders no input box, so there is no text to clear or put
      // back.
      input: { get: () => "", set: () => {} },
      attachments: {
        isUploading: () =>
          attachmentsRef.current.some((a) => a.status === "uploading"),
        consumeReady: () => consumeAttachments(),
      },
      threads,
    }),
  );
  // Clears the notice timer of a blocked send on unmount.
  useEffect(() => () => submitter.showNotice(null), [submitter]);
  const submitMessage = useCallback(
    (value: string) => submitter.submit(value),
    [submitter],
  );

  const contextValue: CopilotChatContextValue = {
    agent,
    isRunning: agent.isRunning,
    messages: agent.messages,
    attachments: selectedAttachments,
    attachmentsEnabled,
    openPicker,
    removeAttachment,
    submitMessage,
  };

  // Publish this chat's agent and thread to the subtree, as the web
  // CopilotChat does. Hooks inside it that name no agent use this chat's
  // agent, which is the outer chat's agent when this chat names none.
  return (
    <CopilotChatConfigurationProvider
      agentId={resolvedAgentId}
      threadId={resolvedThreadId}
      hasExplicitThreadId={hasExplicitThreadId}
    >
      <CopilotChatCtx.Provider value={contextValue}>
        {children}
      </CopilotChatCtx.Provider>
    </CopilotChatConfigurationProvider>
  );
}
