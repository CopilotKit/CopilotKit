import { useAgent } from "../../hooks/use-agent";
import { useSuggestions } from "../../hooks/use-suggestions";
import { CopilotChatView, CopilotChatViewProps } from "./CopilotChatView";
import { CopilotChatInputMode } from "./CopilotChatInput";
import {
  CopilotChatConfigurationProvider,
  CopilotChatLabels,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import {
  DEFAULT_AGENT_ID,
  randomUUID,
  TranscriptionErrorCode,
  getModalityFromMimeType,
  exceedsMaxSize,
  readFileAsBase64,
  generateVideoThumbnail,
  matchesAcceptFilter,
  formatFileSize,
} from "@copilotkit/shared";
import type {
  Attachment,
  AttachmentsConfig,
  InputContent,
} from "@copilotkit/shared";
import { Suggestion, CopilotKitCoreErrorCode } from "@copilotkit/core";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { merge } from "ts-deepmerge";
import {
  useCopilotKit,
  useLicenseContext,
} from "../../providers/CopilotKitProvider";
import { InlineFeatureWarning } from "../../components/license-warning-banner";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { renderSlot, SlotValue } from "../../lib/slots";
import {
  transcribeAudio,
  TranscriptionError,
} from "../../lib/transcription-client";

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
};
export function CopilotChat({
  agentId,
  threadId,
  labels,
  chatView,
  isModalDefaultOpen,
  attachments: attachmentsConfig,
  onError,
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

  const { agent } = useAgent({
    agentId: resolvedAgentId,
    threadId: resolvedThreadId,
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

  // Attachment state
  const attachmentsEnabled = attachmentsConfig?.enabled ?? false;
  const attachmentsAccept = attachmentsConfig?.accept ?? "*/*";
  const attachmentsMaxSize = attachmentsConfig?.maxSize ?? 20 * 1024 * 1024;

  const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>(
    [],
  );
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const processFilesRef = useRef<(files: File[]) => Promise<void>>(
    async () => {},
  );

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
    let detached = false;

    // Create a fresh AbortController so we can cancel the HTTP request on cleanup.
    // HttpAgent (parent of ProxiedCopilotRuntimeAgent) uses this.abortController.signal
    // in its fetch config. Unlike runAgent(), connectAgent() does NOT create a new
    // AbortController automatically, so we must set one before connecting.
    const connectAbortController = new AbortController();
    if (agent instanceof HttpAgent) {
      agent.abortController = connectAbortController;
    }

    const connect = async (agent: AbstractAgent) => {
      try {
        await copilotkit.connectAgent({ agent });
      } catch (error) {
        // Ignore errors from aborted connections (e.g., React StrictMode cleanup)
        if (detached) return;
        // connectAgent already emits via the subscriber system, but catch
        // here to prevent unhandled rejections from unexpected errors.
        console.error("CopilotChat: connectAgent failed", error);
      }
    };
    connect(agent);
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
  }, [resolvedThreadId, agent, resolvedAgentId]);

  // --- Attachment logic ---

  const processFiles = async (files: File[]) => {
    const rejectedFiles = files.filter(
      (file) => !matchesAcceptFilter(file, attachmentsAccept),
    );
    for (const file of rejectedFiles) {
      attachmentsConfig?.onUploadFailed?.({
        reason: "invalid-type",
        file,
        message: `File "${file.name}" is not accepted. Supported types: ${attachmentsAccept}`,
      });
    }

    const validFiles = files.filter((file) =>
      matchesAcceptFilter(file, attachmentsAccept),
    );

    for (const file of validFiles) {
      if (exceedsMaxSize(file, attachmentsMaxSize)) {
        attachmentsConfig?.onUploadFailed?.({
          reason: "file-too-large",
          file,
          message: `File "${file.name}" exceeds the maximum size of ${formatFileSize(attachmentsMaxSize)}`,
        });
        continue;
      }

      const modality = getModalityFromMimeType(file.type);
      const placeholderId = randomUUID();
      const placeholder: Attachment = {
        id: placeholderId,
        type: modality,
        source: { type: "data", value: "", mimeType: file.type },
        filename: file.name,
        size: file.size,
        status: "uploading",
      };

      setSelectedAttachments((prev) => [...prev, placeholder]);

      try {
        let source: Attachment["source"];
        let uploadMetadata: Record<string, unknown> | undefined;

        if (attachmentsConfig?.onUpload) {
          const { metadata: meta, ...uploadSource } =
            await attachmentsConfig.onUpload(file);
          source = uploadSource;
          uploadMetadata = meta;
        } else {
          const base64 = await readFileAsBase64(file);
          source = { type: "data", value: base64, mimeType: file.type };
        }

        let thumbnail: string | undefined;
        if (modality === "video") {
          thumbnail = await generateVideoThumbnail(file);
        }

        setSelectedAttachments((prev) =>
          prev.map((att) =>
            att.id === placeholderId
              ? {
                  ...att,
                  source,
                  status: "ready" as const,
                  thumbnail,
                  metadata: uploadMetadata,
                }
              : att,
          ),
        );
      } catch (error) {
        setSelectedAttachments((prev) =>
          prev.filter((att) => att.id !== placeholderId),
        );
        console.error(`[CopilotKit] Failed to upload "${file.name}":`, error);
        attachmentsConfig?.onUploadFailed?.({
          reason: "upload-failed",
          file,
          message:
            error instanceof Error
              ? error.message
              : `Failed to upload "${file.name}"`,
        });
      }
    }
  };
  processFilesRef.current = processFiles;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    try {
      await processFiles(Array.from(e.target.files));
    } catch (error) {
      console.error("[CopilotKit] Upload error:", error);
    }
  };

  // Drag-and-drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    if (!attachmentsEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!attachmentsEnabled) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      try {
        await processFiles(files);
      } catch (error) {
        console.error("[CopilotKit] Drop error:", error);
      }
    }
  };

  // Clipboard paste handler — scoped to the chat container
  useEffect(() => {
    if (!attachmentsEnabled) return;

    const handlePaste = async (e: ClipboardEvent) => {
      // Only intercept pastes targeting elements inside this chat
      const target = e.target as HTMLElement | null;
      if (!target || !chatContainerRef.current?.contains(target)) return;

      const items = Array.from(e.clipboardData?.items || []);
      const fileItems = items.filter(
        (item) =>
          item.kind === "file" &&
          item.getAsFile() !== null &&
          matchesAcceptFilter(item.getAsFile()!, attachmentsAccept),
      );

      if (fileItems.length === 0) return;
      e.preventDefault();

      const files = fileItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);

      try {
        await processFilesRef.current(files);
      } catch (error) {
        console.error("[CopilotKit] Paste error:", error);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [attachmentsEnabled, attachmentsAccept]);

  // --- End attachment logic ---

  const onSubmitInput = useCallback(
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

      const readyAttachments = selectedAttachments.filter(
        (a) => a.status === "ready",
      );
      setSelectedAttachments([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

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

      // Clear input after submitting
      setInputValue("");
      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error("CopilotChat: runAgent failed", error);
      }
    },
    // copilotkit is intentionally excluded — it is a stable ref that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, selectedAttachments],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent],
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

  // Use message id + role + content length as memo key instead of JSON.stringify
  // to avoid serializing large base64 content on every render while still detecting
  // content changes during streaming
  const messagesMemoKey = agent.messages
    .map((m) => {
      const contentLen =
        typeof m.content === "string"
          ? m.content.length
          : Array.isArray(m.content)
            ? m.content.length
            : 0;
      return `${m.id}:${m.role}:${contentLen}`;
    })
    .join(",");
  const messages = useMemo(() => [...agent.messages], [messagesMemoKey]);

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
    // Attachment props
    attachments: selectedAttachments,
    onRemoveAttachment: (id: string) =>
      setSelectedAttachments((prev) => prev.filter((a) => a.id !== id)),
    onAddFile: attachmentsEnabled
      ? () => {
          // Delay to let Radix dropdown menu close before triggering file input
          setTimeout(() => {
            fileInputRef.current?.click();
          }, 100);
        }
      : undefined,
    dragOver,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  }) as CopilotChatViewProps;

  // Always create a provider with merged values
  // This ensures priority: props > existing config > defaults
  const RenderedChatView = renderSlot(chatView, CopilotChatView, finalProps);

  return (
    <CopilotChatConfigurationProvider
      agentId={resolvedAgentId}
      threadId={resolvedThreadId}
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
            accept={attachmentsAccept}
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
        {RenderedChatView}
      </div>
    </CopilotChatConfigurationProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChat {
  export const View = CopilotChatView;
}
