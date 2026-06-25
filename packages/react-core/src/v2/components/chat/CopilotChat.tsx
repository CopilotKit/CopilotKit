import { useAgent } from "../../hooks/use-agent";
import { useAttachments } from "../../hooks/use-attachments";
import { useSuggestions } from "../../hooks/use-suggestions";
import type { CopilotChatViewProps } from "./CopilotChatView";
import { CopilotChatView } from "./CopilotChatView";
import type { CopilotChatInputMode } from "./CopilotChatInput";
import type { CopilotChatLabels } from "../../providers/CopilotChatConfigurationProvider";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import {
  DEFAULT_AGENT_ID,
  randomUUID,
  TranscriptionErrorCode,
} from "@copilotkit/shared";
import type { AttachmentsConfig, InputContent } from "@copilotkit/shared";
import type { Suggestion, CopilotKitCoreErrorCode } from "@copilotkit/core";
import { isRunCompletionAware } from "@copilotkit/core";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useCopilotKit,
  useLicenseContext,
} from "../../providers/CopilotKitProvider";
import { InlineFeatureWarning } from "../../components/license-warning-banner";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type { SlotValue } from "../../lib/slots";
import { renderSlot, useShallowStableRef } from "../../lib/slots";
import {
  transcribeAudio,
  TranscriptionError,
} from "../../lib/transcription-client";
import { LastUserMessageContext } from "./last-user-message-context";
import type { LastUserMessageState } from "./last-user-message-context";

export type CopilotChatProps = Omit<
  CopilotChatViewProps,
  | "messages"
  | "isRunning"
  | "suggestions"
  | "suggestionLoadingIndexes"
  | "onSelectSuggestion"
  // Attachment state props — managed internally based on `attachments` config
  | "attachments"
  | "onRemoveAttachment"
  | "onAddFile"
  | "dragOver"
  | "onDragOver"
  | "onDragLeave"
  | "onDrop"
> & {
  agentId?: string;
  threadId?: string;
  labels?: Partial<CopilotChatLabels>;
  chatView?: SlotValue<typeof CopilotChatView>;
  isModalDefaultOpen?: boolean;
  /** Enable multimodal file attachments (images, audio, video, documents). */
  attachments?: AttachmentsConfig;
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
   * for this chat instance. Forwarded to the internal `useAgent()` hook,
   * which resolves the effective throttle value.
   *
   * @default undefined — inherits from provider `defaultThrottleMs`;
   * if that is also unset, re-renders are unthrottled. Note: passing
   * `throttleMs={0}` explicitly disables throttling for this instance
   * even when the provider specifies a non-zero `defaultThrottleMs`.
   */
  throttleMs?: number;
};
export function CopilotChat({
  agentId,
  threadId,
  labels,
  chatView,
  isModalDefaultOpen,
  attachments: attachmentsConfig,
  onError,
  throttleMs,
  ...props
}: CopilotChatProps) {
  // Check for existing configuration provider
  const existingConfig = useCopilotChatConfiguration();

  // Apply priority: props > existing config > defaults
  const resolvedAgentId =
    agentId ?? existingConfig?.agentId ?? DEFAULT_AGENT_ID;
  const providedThreadId = threadId ?? existingConfig?.threadId;
  const resolvedThreadId = useMemo(
    () => providedThreadId ?? randomUUID(),
    [providedThreadId],
  );
  // "Explicit" means a caller actually picked this thread — via the
  // `threadId` prop on CopilotChat or a wrapping provider that marked its
  // threadId as caller-chosen. An auto-minted UUID leaking down through a
  // CopilotChatConfigurationProvider (e.g. from the v1 CopilotKit →
  // ThreadsProvider chain) does NOT count; treating it as explicit is
  // what made /connect fire against 404s and the welcome screen stay
  // hidden for fresh empty chats.
  const hasExplicitThreadId =
    !!threadId || !!existingConfig?.hasExplicitThreadId;

  const { agent } = useAgent({
    agentId: resolvedAgentId,
    throttleMs,
  });
  const { copilotkit } = useCopilotKit();
  const { suggestions: autoSuggestions } = useSuggestions({
    agentId: resolvedAgentId,
  });

  const { checkFeature } = useLicenseContext();
  const isChatLicensed = checkFeature("chat");

  useEffect(() => {
    if (!isChatLicensed) {
      console.warn(
        '[CopilotKit] Warning: "chat" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  }, [isChatLicensed]);

  // onError subscription — forward core errors scoped to this chat's agent
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

  // Transcription state
  const [transcribeMode, setTranscribeMode] =
    useState<CopilotChatInputMode>("input");
  const [inputValue, setInputValue] = useState("");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Attachments
  const {
    attachments: selectedAttachments,
    enabled: attachmentsEnabled,
    dragOver,
    fileInputRef,
    containerRef: chatContainerRef,
    handleFileUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    consumeAttachments,
  } = useAttachments({ config: attachmentsConfig });

  // onSubmitInput awaits an in-flight run before sending the new message, so
  // it must re-check the "uploading" guard against FRESH state AFTER the await
  // — the closure-captured `selectedAttachments` is stale across the await
  // (an upload can start during the wait).
  const selectedAttachmentsRef = useRef(selectedAttachments);
  useEffect(() => {
    selectedAttachmentsRef.current = selectedAttachments;
  }, [selectedAttachments]);

  // Check if transcription is enabled
  const isTranscriptionEnabled = copilotkit.audioFileTranscriptionEnabled;

  // Check if browser supports MediaRecorder
  const isMediaRecorderSupported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  const {
    messageView: providedMessageView,
    suggestionView: providedSuggestionView,
    onStop: providedStopHandler,
    ...restProps
  } = props;

  // Tracks the last threadId for which connectAgent has completed (success or
  // failure). When the user supplies a threadId, we're in "resume existing
  // thread" mode — the welcome screen should be suppressed until the connect
  // resolves, otherwise switching threads flashes the welcome screen while the
  // new thread's messages are still en route.
  const [lastConnectedThreadId, setLastConnectedThreadId] = useState<
    string | null
  >(null);
  const isConnecting =
    hasExplicitThreadId && lastConnectedThreadId !== resolvedThreadId;

  useEffect(() => {
    // Non-explicit threads skip /connect, but the first runAgent still has to
    // ship the same SDK-generated threadId that the chat UI is rendering.
    agent.threadId = resolvedThreadId;

    let detached = false;

    // Create a fresh AbortController so we can cancel the HTTP request on cleanup.
    // HttpAgent (parent of ProxiedCopilotRuntimeAgent) uses this.abortController.signal
    // in its fetch config. Unlike runAgent(), connectAgent() does NOT create a new
    // AbortController automatically, so we must set one before connecting.
    const connectAbortController = new AbortController();

    // When the caller hasn't picked a specific thread, resolvedThreadId is a
    // UUID minted locally (either in this CopilotChat or in a wrapping
    // ThreadsProvider). The backend has never seen it, so /connect would
    // always 404 — skip the call. A real thread is only created once the
    // user runs the agent for the first time.
    if (hasExplicitThreadId) {
      if (agent instanceof HttpAgent) {
        agent.abortController = connectAbortController;
      }

      const connect = async (agentToConnect: AbstractAgent) => {
        try {
          await copilotkit.connectAgent({ agent: agentToConnect });
        } catch (error) {
          // Ignore errors from aborted connections (e.g., React StrictMode cleanup)
          if (detached) return;
          // connectAgent already emits via the subscriber system, but catch
          // here to prevent unhandled rejections from unexpected errors.
          console.error("CopilotChat: connectAgent failed", error);
        } finally {
          // Whether the connect succeeded or failed, we're no longer in the
          // transitional "connecting" state for this thread — unblock the
          // welcome-screen-suppression so the view can settle.
          //
          // Defer one animation frame so any trailing React commits from the
          // bootstrap replay (final assistant message content) paint before
          // isConnecting flips off. Without this, suggestions + copy button
          // can briefly appear against an incompletely-laid-out message tree
          // and visibly snap once the last text chunk lands.
          if (!detached) {
            const raf =
              typeof requestAnimationFrame === "function"
                ? requestAnimationFrame
                : (cb: () => void) => setTimeout(cb, 16);
            raf(() => {
              if (!detached) setLastConnectedThreadId(resolvedThreadId);
            });
          }
        }
      };
      connect(agent);
    }

    // The cleanup is registered even when no connect() was issued above: a
    // run can be streaming on a non-explicit (locally-minted) thread, and a
    // thread switch must detach it BEFORE the shared per-agentId agent is
    // repointed at the new thread. An early return here is what let the old
    // run keep applying events to the agent and collide with the next
    // thread's connect replay ("Cannot send 'RUN_STARTED' while a run is
    // still active").
    return () => {
      // Abort the HTTP request and detach the active run.
      // This is critical for React StrictMode which unmounts+remounts in dev,
      // preventing duplicate /connect requests from reaching the server.
      detached = true;
      connectAbortController.abort();
      // The .catch() is required to prevent a false-positive "Uncaught (in promise)
      // AbortError" in browser devtools. detachActiveRun() itself does not reject,
      // but without an attached handler V8 flags the promise chain as unhandled
      // when the abort signal propagates through connected promises internally.
      void agent.detachActiveRun().catch(() => {});
    };
    // copilotkit is intentionally excluded — it is a stable ref that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedThreadId, agent, resolvedAgentId, hasExplicitThreadId]);

  // Serializes consecutive sends: if a run is already in flight, let it finish
  // before dispatching the next message instead of pre-empting it.
  // `copilotkit.runAgent` would otherwise call `agent.detachActiveRun()` and
  // ABORT the in-flight run. That abort is harmful when the in-flight run is an
  // interrupt RESUME: the resume re-enters and completes the paused agent
  // graph, and aborting it mid-flight leaves the graph paused — so the new
  // message lands as another resume of the SAME paused graph (re-interrupting
  // with no fresh payload) instead of starting a clean new turn. This is the
  // consecutive-interrupt regression: pick turn-1's slot (kicks off the
  // resume), then immediately send turn-2's message — without waiting, turn-2
  // aborts the resume and the 2nd interrupt's card never mounts. Awaiting the
  // active run's completion serializes the two turns so the resume finishes
  // (graph completes) before the new message starts a fresh run.
  //
  // The completion promise lives only on `IntelligenceAgent` (via the
  // `RunCompletionAware` contract), not on the `AbstractAgent` type held here —
  // so it is reached through a type guard, not a cast. Agents that don't
  // implement the contract degrade safely (the await is skipped).
  const waitForActiveRunToSettle = useCallback(async () => {
    // Widen to `unknown` before the guard: narrowing `AbstractAgent` directly
    // would intersect with its PRIVATE `activeRunCompletionPromise` declaration
    // and collapse the narrowed type to `never`.
    const maybeAware: unknown = agent;
    const activeRunCompletionPromise = isRunCompletionAware(maybeAware)
      ? maybeAware.activeRunCompletionPromise
      : undefined;
    if (agent.isRunning && activeRunCompletionPromise) {
      try {
        await activeRunCompletionPromise;
      } catch (error) {
        // The in-flight run rejected — proceed with the new send anyway,
        // but log so a chronically-failing in-flight run is observable.
        console.error(
          "CopilotChat: in-flight run rejected while queuing send",
          error,
        );
      }
    }
  }, [agent]);

  const onSubmitInput = useCallback(
    async (value: string) => {
      // Block if uploads in progress (fast fail against current state before
      // the value is committed — re-checked against live state after the
      // await below, since an upload can start during the wait).
      if (
        selectedAttachmentsRef.current.some((a) => a.status === "uploading")
      ) {
        console.error(
          "[CopilotKit] Cannot send while attachments are uploading (pre-await guard)",
        );
        setTranscriptionError("Cannot send while attachments are uploading.");
        return;
      }

      // Clear the input immediately so the composer reflects the accepted send
      // even though the actual dispatch may be deferred behind the in-flight
      // run. If the post-await guard later BLOCKS the send (e.g. an upload
      // starts during the await), the typed text is RESTORED to the composer
      // below so it is never silently lost.
      setInputValue("");

      // If a run is already in flight, let it finish before sending the new
      // message instead of pre-empting it (see waitForActiveRunToSettle).
      await waitForActiveRunToSettle();

      // Re-check the uploading guard against LIVE attachment state: an upload
      // can start (or stay in flight) during the await above, so a snapshot
      // taken before the await could consume an attachment with an incomplete
      // source. On block, RESTORE the typed text to the composer (it was
      // optimistically cleared on accept) so the user's input is not silently
      // lost, and surface a user-visible banner — console.error alone is
      // invisible to the user.
      if (
        selectedAttachmentsRef.current.some((a) => a.status === "uploading")
      ) {
        console.error(
          "[CopilotKit] Cannot send while attachments are uploading (post-await re-check)",
        );
        setTranscriptionError("Cannot send while attachments are uploading.");
        setInputValue(value);
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
    // copilotkit is intentionally excluded — it is a stable ref that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, consumeAttachments, waitForActiveRunToSettle],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      // Mirror onSubmitInput's send-serialization: if a run is in flight, wait
      // for it to settle before dispatching, so selecting a suggestion mid-run
      // does NOT pre-empt/abort the active run (the same #5195 fix the
      // typed-Enter path got — here for the suggestion path).
      await waitForActiveRunToSettle();

      agent.addMessage({
        id: randomUUID(),
        role: "user",
        content: suggestion.message,
      });

      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error(
          "CopilotChat: runAgent failed after selecting suggestion",
          error,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, waitForActiveRunToSettle],
  );

  const stopCurrentRun = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (error) {
      console.error("CopilotChat: stopAgent failed", error);
      try {
        agent.abortRun();
      } catch (abortError) {
        console.error("CopilotChat: abortRun fallback failed", abortError);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  // Transcription handlers
  const handleStartTranscribe = useCallback(() => {
    setTranscriptionError(null);
    setTranscribeMode("transcribe");
  }, []);

  const handleCancelTranscribe = useCallback(() => {
    setTranscriptionError(null);
    setTranscribeMode("input");
  }, []);

  const handleFinishTranscribe = useCallback(() => {
    setTranscribeMode("input");
  }, []);

  // Handle audio blob from CopilotChatInput and transcribe it
  const handleFinishTranscribeWithAudio = useCallback(
    async (audioBlob: Blob) => {
      setIsTranscribing(true);
      try {
        setTranscriptionError(null);

        // Send to transcription endpoint
        const result = await transcribeAudio(copilotkit, audioBlob);

        // Insert transcribed text into input
        setInputValue((prev) => {
          const trimmedPrev = prev.trim();
          if (trimmedPrev) {
            return `${trimmedPrev} ${result.text}`;
          }
          return result.text;
        });
      } catch (error) {
        console.error("CopilotChat: Transcription failed", error);

        // Show contextual error message based on error type
        if (error instanceof TranscriptionError) {
          const { code, retryable, message } = error.info;
          switch (code) {
            case TranscriptionErrorCode.RATE_LIMITED:
              setTranscriptionError("Too many requests. Please wait a moment.");
              break;
            case TranscriptionErrorCode.AUTH_FAILED:
              setTranscriptionError(
                "Authentication error. Please check your configuration.",
              );
              break;
            case TranscriptionErrorCode.AUDIO_TOO_LONG:
              setTranscriptionError(
                "Recording is too long. Please try a shorter recording.",
              );
              break;
            case TranscriptionErrorCode.AUDIO_TOO_SHORT:
              setTranscriptionError(
                "Recording is too short. Please try again.",
              );
              break;
            case TranscriptionErrorCode.INVALID_AUDIO_FORMAT:
              setTranscriptionError("Audio format not supported.");
              break;
            case TranscriptionErrorCode.SERVICE_NOT_CONFIGURED:
              setTranscriptionError("Transcription service is not available.");
              break;
            case TranscriptionErrorCode.NETWORK_ERROR:
              setTranscriptionError(
                "Network error. Please check your connection.",
              );
              break;
            default:
              // For retryable errors, show more helpful message
              setTranscriptionError(
                retryable ? "Transcription failed. Please try again." : message,
              );
          }
        } else {
          // Fallback for unexpected errors
          setTranscriptionError("Transcription failed. Please try again.");
        }
      } finally {
        setIsTranscribing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Clear transcription error after a delay
  useEffect(() => {
    if (transcriptionError) {
      const timer = setTimeout(() => {
        setTranscriptionError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [transcriptionError]);

  // Stabilize slot object references so inline props (new object reference on
  // every parent render) don't defeat MemoizedSlotWrapper's shallow equality
  // check and cause unnecessary re-renders of the message list on each keystroke.
  const stableMessageView = useShallowStableRef(
    typeof providedMessageView === "string"
      ? { className: providedMessageView }
      : providedMessageView,
  );
  const stableSuggestionView = useShallowStableRef(providedSuggestionView);

  // Stabilize the `onAddFile` handler. Without useCallback, a new arrow
  // function is created inline on every render, causing CopilotChatView to
  // re-render on every keystroke even when nothing else changed.
  const handleAddFile = useCallback(() => {
    // Delay to let Radix dropdown menu close before triggering file input
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 100);
  }, []);

  // Use shallow spread instead of ts-deepmerge. ts-deepmerge deep-clones plain
  // objects even from a single source, which would defeat the reference
  // stability we just established for stableMessageView and other slot values.
  const mergedProps: Partial<CopilotChatViewProps> = {
    isRunning: agent.isRunning,
    suggestions: autoSuggestions,
    onSelectSuggestion: handleSelectSuggestion,
    suggestionView: stableSuggestionView,
    ...restProps,
  };
  if (stableMessageView !== undefined)
    mergedProps.messageView = stableMessageView;

  const hasMessages = agent.messages.length > 0;
  const shouldAllowStop = agent.isRunning && hasMessages;
  const effectiveStopHandler = shouldAllowStop
    ? (providedStopHandler ?? stopCurrentRun)
    : providedStopHandler;

  // Determine if transcription feature should be available
  const showTranscription = isTranscriptionEnabled && isMediaRecorderSupported;

  // Determine mode: transcribing takes priority, then transcribe mode, then default to input
  const effectiveMode: CopilotChatInputMode = isTranscribing
    ? "processing"
    : transcribeMode;

  // Memoize messages array — only create a new reference when content changes.
  // We build a lightweight fingerprint instead of JSON.stringify to avoid
  // serializing large base64 attachment data on every render. The key captures:
  //   - message id, role, content length (text streaming)
  //   - content part count (multimodal additions)
  //   - tool call ids + argument lengths (tool call streaming)
  const messagesMemoKey = agent.messages
    .map((m) => {
      const contentKey =
        typeof m.content === "string"
          ? m.content.length
          : Array.isArray(m.content)
            ? m.content.length
            : 0;
      const toolCallsKey =
        "toolCalls" in m && Array.isArray(m.toolCalls)
          ? m.toolCalls
              .map(
                (tc: any) => `${tc.id}:${tc.function?.arguments?.length ?? 0}`,
              )
              .join(";")
          : "";
      return `${m.id}:${m.role}:${contentKey}:${toolCallsKey}`;
    })
    .join(",");
  const messages = useMemo(
    () => [...agent.messages],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messagesMemoKey],
  );

  // Compute the ID of the last user message for scroll-pinning logic.
  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  // Track a nonce that increments each time a new user message ID appears.
  // Using useState ensures the context value propagates correctly on the
  // render that follows the state update (approach b from the design doc).
  const [sendNonce, setSendNonce] = useState(0);
  // Seed with the current value so restoring a thread with existing messages
  // does not count as a new send. Only later-render id transitions bump.
  const prevLastUserMessageIdRef = useRef<string | null>(lastUserMessageId);

  useEffect(() => {
    if (
      lastUserMessageId &&
      lastUserMessageId !== prevLastUserMessageIdRef.current
    ) {
      setSendNonce((n) => n + 1);
      prevLastUserMessageIdRef.current = lastUserMessageId;
    }
  }, [lastUserMessageId]);

  const lastUserMessageState = useMemo<LastUserMessageState>(
    () => ({ id: lastUserMessageId, sendNonce }),
    [lastUserMessageId, sendNonce],
  );

  const finalProps: CopilotChatViewProps = {
    ...mergedProps,
    messages,
    // Input behavior props
    onSubmitMessage: onSubmitInput,
    onStop: effectiveStopHandler,
    inputMode: effectiveMode,
    inputValue,
    onInputChange: setInputValue,
    // Only provide transcription handlers if feature is available
    onStartTranscribe: showTranscription ? handleStartTranscribe : undefined,
    onCancelTranscribe: showTranscription ? handleCancelTranscribe : undefined,
    onFinishTranscribe: showTranscription ? handleFinishTranscribe : undefined,
    onFinishTranscribeWithAudio: showTranscription
      ? handleFinishTranscribeWithAudio
      : undefined,
    // Attachment props
    attachments: selectedAttachments,
    onRemoveAttachment: removeAttachment,
    onAddFile: attachmentsEnabled ? handleAddFile : undefined,
    dragOver,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    isConnecting,
    hasExplicitThreadId,
  };

  // Always create a provider with merged values
  // This ensures priority: props > existing config > defaults
  const RenderedChatView = renderSlot(chatView, CopilotChatView, finalProps);

  return (
    <CopilotChatConfigurationProvider
      agentId={resolvedAgentId}
      threadId={resolvedThreadId}
      hasExplicitThreadId={hasExplicitThreadId}
      labels={labels}
      isModalDefaultOpen={isModalDefaultOpen}
    >
      <div ref={chatContainerRef} style={{ display: "contents" }}>
        {attachmentsEnabled && (
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept={attachmentsConfig?.accept ?? "*/*"}
            style={{ display: "none" }}
          />
        )}
        {!isChatLicensed && <InlineFeatureWarning featureName="Chat" />}
        {transcriptionError && (
          <div
            style={{
              position: "absolute",
              bottom: "100px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "#ef4444",
              color: "white",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "14px",
              zIndex: 50,
            }}
          >
            {transcriptionError}
          </div>
        )}
        <LastUserMessageContext.Provider value={lastUserMessageState}>
          {RenderedChatView}
        </LastUserMessageContext.Provider>
      </div>
    </CopilotChatConfigurationProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChat {
  export const View = CopilotChatView;
}
