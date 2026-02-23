import { useAgent } from "@/hooks/use-agent";
import { useSuggestions } from "@/hooks/use-suggestions";
import { CopilotChatView, CopilotChatViewProps } from "./CopilotChatView";
import { CopilotChatInputMode } from "./CopilotChatInput";
import {
  CopilotChatConfigurationProvider,
  CopilotChatLabels,
  useCopilotChatConfiguration,
} from "@/providers/CopilotChatConfigurationProvider";
import {
  DEFAULT_AGENT_ID,
  randomUUID,
  TranscriptionErrorCode,
} from "@copilotkitnext/shared";
import { Suggestion, CopilotKitCoreErrorCode } from "@copilotkitnext/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { merge } from "ts-deepmerge";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { AbstractAgent, AGUIConnectNotImplementedError } from "@ag-ui/client";
import { renderSlot, SlotValue } from "@/lib/slots";
import {
  transcribeAudio,
  TranscriptionError,
} from "@/lib/transcription-client";

export type CopilotChatProps = Omit<
  CopilotChatViewProps,
  | "messages"
  | "isRunning"
  | "suggestions"
  | "suggestionLoadingIndexes"
  | "onSelectSuggestion"
> & {
  agentId?: string;
  threadId?: string;
  labels?: Partial<CopilotChatLabels>;
  chatView?: SlotValue<typeof CopilotChatView>;
};
export function CopilotChat({
  agentId,
  threadId,
  labels,
  chatView,
  ...props
}: CopilotChatProps) {
  // Check for existing configuration provider
  const existingConfig = useCopilotChatConfiguration();

  // Apply priority: props > existing config > defaults
  const resolvedAgentId =
    agentId ?? existingConfig?.agentId ?? DEFAULT_AGENT_ID;
  const resolvedThreadId = useMemo(
    () => threadId ?? existingConfig?.threadId ?? randomUUID(),
    [threadId, existingConfig?.threadId],
  );

  const { agent } = useAgent({ agentId: resolvedAgentId });
  const { copilotkit } = useCopilotKit();
  const { suggestions: autoSuggestions } = useSuggestions({
    agentId: resolvedAgentId,
  });

  // Transcription state
  const [transcribeMode, setTranscribeMode] =
    useState<CopilotChatInputMode>("input");
  const [inputValue, setInputValue] = useState("");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const [isTranscribing, setIsTranscribing] = useState(false);

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

  useEffect(() => {
    const connect = async (agent: AbstractAgent) => {
      try {
        await copilotkit.connectAgent({ agent });
      } catch (error) {
        if (error instanceof AGUIConnectNotImplementedError) {
          // connect not implemented, ignore
        } else {
          throw error;
        }
      }
    };
    agent.threadId = resolvedThreadId;
    connect(agent);
    return () => {};
  }, [resolvedThreadId, agent, copilotkit, resolvedAgentId]);

  const onSubmitInput = useCallback(
    async (value: string) => {
      agent.addMessage({
        id: randomUUID(),
        role: "user",
        content: value,
      });
      // Clear input after submitting
      setInputValue("");
      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error("CopilotChat: runAgent failed", error);
      }
    },
    [agent, copilotkit],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: Suggestion) => {
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
    [agent, copilotkit],
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
  }, [agent, copilotkit]);

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
    [copilotkit],
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

  const mergedProps = merge(
    {
      isRunning: agent.isRunning,
      suggestions: autoSuggestions,
      onSelectSuggestion: handleSelectSuggestion,
      suggestionView: providedSuggestionView,
    },
    {
      ...restProps,
      ...(typeof providedMessageView === "string"
        ? { messageView: { className: providedMessageView } }
        : providedMessageView !== undefined
          ? { messageView: providedMessageView }
          : {}),
    },
  );

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

  // Memoize messages array - only create new reference when content actually changes
  // (agent.messages is mutated in place, so we need a new reference for React to detect changes)

  const messages = useMemo(
    () => [...agent.messages],
    [JSON.stringify(agent.messages)],
  );

  const finalProps = merge(mergedProps, {
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
  }) as CopilotChatViewProps;

  // Always create a provider with merged values
  // This ensures priority: props > existing config > defaults
  const RenderedChatView = renderSlot(chatView, CopilotChatView, finalProps);

  return (
    <CopilotChatConfigurationProvider
      agentId={resolvedAgentId}
      threadId={resolvedThreadId}
      labels={labels}
    >
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
      {RenderedChatView}
    </CopilotChatConfigurationProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChat {
  export const View = CopilotChatView;
}
