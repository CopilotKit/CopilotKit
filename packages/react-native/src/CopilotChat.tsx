import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { useAgent } from "@copilotkit/react-core/v2/headless";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import type { InputContent } from "@copilotkit/shared";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";
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
   * Submit a message with optional attachments.
   * Handles consuming ready attachments, building InputContent[],
   * calling agent.addMessage, and running the agent.
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

export interface CopilotChatProps {
  /**
   * The agent ID to use for this chat session.
   * Matches the web SDK's CopilotChat `agentId` prop.
   *
   * Resolution order: `agentId` > `agentName` > `"default"`
   */
  agentId?: string;

  /**
   * @deprecated Use `agentId` instead. `agentName` is kept for backwards
   * compatibility and will be removed in a future release.
   */
  agentName?: string;

  /**
   * Thread ID for this chat session. When provided, the chat will resume
   * the specified thread. Matches the web SDK's CopilotChat `threadId` prop.
   */
  threadId?: string;

  /**
   * Error handler scoped to this chat's agent. Fires in addition to the
   * provider-level onError (does not suppress it). Receives only errors
   * whose context.agentId matches this chat's agent.
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
  const resolvedAgentId = agentId ?? agentName ?? DEFAULT_AGENT_ID;

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

  const { agent } = useAgent({ agentId: resolvedAgentId, throttleMs });

  // Set threadId on the agent when provided
  useEffect(() => {
    if (threadId) {
      agent.threadId = threadId;
    }
  }, [agent, threadId]);

  // onError subscription -- forward core errors scoped to this chat's agent
  const { copilotkit } = useCopilotKit();
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!onErrorRef.current) return;

    const subscription = copilotkit.subscribe({
      onError: (event) => {
        // Only forward errors that match this chat's agent
        if (
          event.context?.agentId === resolvedAgentId ||
          !event.context?.agentId
        ) {
          onErrorRef.current?.({
            error: event.error,
            code: event.code,
            context: event.context,
          });
        }
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit, resolvedAgentId]);

  // Attachments
  const {
    attachments: selectedAttachments,
    enabled: attachmentsEnabled,
    openPicker,
    removeAttachment,
    consumeAttachments,
  } = useAttachments({ config: attachmentsConfig });

  // Submit handler -- mirrors web CopilotChat.tsx lines 234-288
  const submitMessage = useCallback(
    async (value: string) => {
      // Block if uploads in progress
      const hasUploading = selectedAttachments.some(
        (a) => a.status === "uploading",
      );
      if (hasUploading) {
        console.error(
          "[CopilotKit] Cannot send while attachments are uploading",
        );
        return;
      }

      const readyAttachments = consumeAttachments();

      if (readyAttachments.length > 0) {
        const contentParts: InputContent[] = [];
        if (value.trim()) {
          contentParts.push({ type: "text", text: value });
        }
        for (const att of readyAttachments) {
          contentParts.push({
            type: att.type,
            source: att.source,
            metadata: {
              ...(att.filename ? { filename: att.filename } : {}),
              ...att.metadata,
            },
          } as InputContent);
        }
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: contentParts,
        });
      } else {
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: value,
        });
      }

      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error("CopilotChat: runAgent failed", error);
      }
    },
    // copilotkit is intentionally excluded -- it is a stable ref that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, selectedAttachments, consumeAttachments],
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

  return (
    <CopilotChatCtx.Provider value={contextValue}>
      {children}
    </CopilotChatCtx.Provider>
  );
}
