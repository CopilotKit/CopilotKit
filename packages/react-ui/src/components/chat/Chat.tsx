/**
 * <br/>
 * <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/CopilotChat.gif" width="500" />
 *
 * A chatbot panel component for the CopilotKit framework. The component allows for a high degree
 * of customization through various props and custom CSS.
 *
 * ## Install Dependencies
 *
 * This component is part of the [@copilotkit/react-ui](https://npmjs.com/package/@copilotkit/react-ui) package.
 *
 * ```shell npm2yarn \"@copilotkit/react-ui"\
 * npm install @copilotkit/react-core @copilotkit/react-ui
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import { CopilotChat } from "@copilotkit/react-ui";
 * import "@copilotkit/react-ui/styles.css";
 *
 * <CopilotChat
 *   labels={{
 *     title: "Your Assistant",
 *     initial: "Hi! 👋 How can I assist you today?",
 *   }}
 * />
 * ```
 *
 * ### With Observability Hooks
 *
 * To monitor user interactions, provide the `observabilityHooks` prop.
 * **Note:** This requires a `publicApiKey` in the `<CopilotKit>` provider.
 *
 * ```tsx
 * <CopilotKit publicApiKey="YOUR_PUBLIC_API_KEY">
 *   <CopilotChat
 *     observabilityHooks={{
 *       onMessageSent: (message) => {
 *         console.log("Message sent:", message);
 *       },
 *     }}
 *   />
 * </CopilotKit>
 * ```
 *
 * ### Look & Feel
 *
 * By default, CopilotKit components do not have any styles. You can import CopilotKit's stylesheet at the root of your project:
 * ```tsx title="YourRootComponent.tsx"
 * ...
 * import "@copilotkit/react-ui/styles.css"; // [!code highlight]
 *
 * export function YourRootComponent() {
 *   return (
 *     <CopilotKit>
 *       ...
 *     </CopilotKit>
 *   );
 * }
 * ```
 * For more information about how to customize the styles, check out the [Customize Look & Feel](/guides/custom-look-and-feel/customize-built-in-ui-components) guide.
 */

import {
  ChatContext,
  ChatContextProvider,
  CopilotChatIcons,
  CopilotChatLabels,
} from "./ChatContext";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { RenderMessage as DefaultRenderMessage } from "./messages/RenderMessage";
import { AssistantMessage as DefaultAssistantMessage } from "./messages/AssistantMessage";
import { UserMessage as DefaultUserMessage } from "./messages/UserMessage";
import { ImageRenderer as DefaultImageRenderer } from "./messages/ImageRenderer";
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  SystemMessageFunction,
  useCopilotContext,
  useCopilotChatInternal,
  type OnStopGeneration,
  type OnReloadMessages,
  type ChatSuggestions,
} from "@copilotkit/react-core";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotErrorEvent,
  Message,
  Severity,
  ErrorVisibility,
  styledConsole,
  CopilotErrorHandler,
  randomUUID,
} from "@copilotkit/shared";
import {
  AssistantMessageProps,
  ChatError,
  ComponentsMap,
  CopilotObservabilityHooks,
  ErrorMessageProps,
  ImageRendererProps,
  InputProps,
  MessagesProps,
  RenderMessageProps,
  RenderSuggestionsListProps,
  UserMessageProps,
} from "./props";

import { AttachmentQueue } from "./AttachmentQueue";
import type { Attachment, AttachmentsConfig } from "./props";
import {
  getModalityFromMimeType,
  exceedsMaxSize,
  readFileAsBase64,
  generateVideoThumbnail,
  matchesAcceptFilter,
  formatFileSize,
  deprecationWarning,
} from "./attachment-utils";
import type { InputContent } from "@copilotkit/shared";
import { Suggestions as DefaultRenderSuggestionsList } from "./Suggestions";

/**
 * Props for CopilotChat component.
 */
export interface CopilotChatProps {
  /**
   * Custom instructions to be added to the system message. Use this property to
   * provide additional context or guidance to the language model, influencing
   * its responses. These instructions can include specific directions,
   * preferences, or criteria that the model should consider when generating
   * its output, thereby tailoring the conversation more precisely to the
   * user's needs or the application's requirements.
   */
  instructions?: string;

  /**
   * Controls the behavior of suggestions in the chat interface.
   *
   * `auto` (default) - Suggestions are generated automatically:
   *   - When the chat is first opened (empty state)
   *   - After each message exchange completes
   *   - Uses configuration from `useCopilotChatSuggestions` hooks
   *
   * `manual` - Suggestions are controlled programmatically:
   *   - Use `setSuggestions()` to set custom suggestions
   *   - Use `generateSuggestions()` to trigger AI generation
   *   - Access via `useCopilotChat` hook
   *
   * `SuggestionItem[]` - Static suggestions array:
   *   - Always shows the same suggestions
   *   - No AI generation involved
   */
  suggestions?: ChatSuggestions;

  /**
   * A callback that gets called when the in progress state changes.
   */
  onInProgress?: (inProgress: boolean) => void;

  /**
   * A callback that gets called when a new message it submitted.
   */
  onSubmitMessage?: (message: string) => void | Promise<void>;

  /**
   * A custom stop generation function.
   */
  onStopGeneration?: OnStopGeneration;

  /**
   * A custom reload messages function.
   */
  onReloadMessages?: OnReloadMessages;

  /**
   * A callback function to regenerate the assistant's response
   */
  onRegenerate?: (messageId: string) => void;

  /**
   * A callback function when the message is copied
   */
  onCopy?: (message: string) => void;

  /**
   * A callback function for thumbs up feedback
   */
  onThumbsUp?: (message: Message) => void;

  /**
   * A callback function for thumbs down feedback
   */
  onThumbsDown?: (message: Message) => void;

  /**
   * A list of markdown components to render in assistant message.
   * Useful when you want to render custom elements in the message (e.g a reference tag element)
   */
  markdownTagRenderers?: ComponentsMap;

  /**
   * Icons can be used to set custom icons for the chat window.
   */
  icons?: CopilotChatIcons;

  /**
   * Labels can be used to set custom labels for the chat window.
   */
  labels?: CopilotChatLabels;

  /**
   * @deprecated Use `attachments={{ enabled: true }}` instead.
   * `imageUploadsEnabled` only supports images. The new `attachments` prop supports
   * images, audio, video, and documents.
   * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
   * @since 1.56.0
   *
   * Enable image upload button (image inputs only supported on some models)
   */
  imageUploadsEnabled?: boolean;

  /**
   * @deprecated Use `attachments={{ enabled: true, accept: "..." }}` instead.
   * The `accept` field on the `attachments` prop replaces `inputFileAccept`.
   * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
   * @since 1.56.0
   *
   * The 'accept' attribute for the file input used for image uploads.
   * Defaults to "image/*".
   */
  inputFileAccept?: string;

  /**
   * Configuration for file attachments in the chat input.
   * Enables users to attach images, audio, video, and documents.
   *
   * @example
   * ```tsx
   * <CopilotChat
   *   attachments={{
   *     enabled: true,
   *     accept: "image/*,application/pdf",
   *     maxSize: 10 * 1024 * 1024, // 10MB
   *     onUpload: async (file) => {
   *       const url = await uploadToS3(file);
   *       return { url, mimeType: file.type };
   *     },
   *   }}
   * />
   * ```
   */
  attachments?: AttachmentsConfig;

  /**
   * A function that takes in context string and instructions and returns
   * the system message to include in the chat request.
   * Use this to completely override the system message, when providing
   * instructions is not enough.
   */
  makeSystemMessage?: SystemMessageFunction;

  /**
   * Disables inclusion of CopilotKit’s default system message. When true, no system message is sent (this also suppresses any custom message from <code>makeSystemMessage</code>).
   */
  disableSystemMessage?: boolean;

  /**
   * A custom assistant message component to use instead of the default.
   */
  AssistantMessage?: React.ComponentType<AssistantMessageProps>;

  /**
   * A custom user message component to use instead of the default.
   */
  UserMessage?: React.ComponentType<UserMessageProps>;

  /**
   * A custom error message component to use instead of the default.
   */
  ErrorMessage?: React.ComponentType<ErrorMessageProps>;

  /**
   * A custom Messages component to use instead of the default.
   */
  Messages?: React.ComponentType<MessagesProps>;

  /**
   * @deprecated - use RenderMessage instead
   */
  RenderTextMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated - use RenderMessage instead
   */
  RenderActionExecutionMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated - use RenderMessage instead
   */
  RenderAgentStateMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated - use RenderMessage instead
   */
  RenderResultMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated - use RenderMessage instead
   */
  RenderImageMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * A custom RenderMessage component to use instead of the default.
   *
   * **Warning**: This is a break-glass solution to allow for custom
   * rendering of messages. You are most likely looking to swap out
   * the AssistantMessage and UserMessage components instead which
   * are also props.
   */
  RenderMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * A custom suggestions list component to use instead of the default.
   */
  RenderSuggestionsList?: React.ComponentType<RenderSuggestionsListProps>;

  /**
   * A custom Input component to use instead of the default.
   */
  Input?: React.ComponentType<InputProps>;

  /**
   * @deprecated Use the v2 `CopilotChat` attachment system instead.
   * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
   *
   * A custom image rendering component to use instead of the default.
   */
  ImageRenderer?: React.ComponentType<ImageRendererProps>;

  /**
   * A class name to apply to the root element.
   */
  className?: string;

  /**
   * Children to render.
   */
  children?: React.ReactNode;

  hideStopButton?: boolean;

  /**
   * Event hooks for CopilotKit chat events.
   * These hooks only work when publicApiKey is provided.
   */
  observabilityHooks?: CopilotObservabilityHooks;

  /**
   * Custom error renderer for chat-specific errors.
   * When provided, errors will be displayed inline within the chat interface.
   */
  renderError?: (error: {
    message: string;
    operation?: string;
    timestamp: number;
    onDismiss: () => void;
    onRetry?: () => void;
  }) => React.ReactNode;

  /**
   * Optional handler for comprehensive debugging and observability.
   */
  onError?: CopilotErrorHandler;
}

/**
 * @deprecated Use the `Attachment` type from `@copilotkit/react-ui` instead.
 * `ImageUpload` only described image payloads. `Attachment` supports images,
 * audio, video, and documents.
 * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
 * @since 1.56.0
 */
export type ImageUpload = {
  contentType: string;
  bytes: string;
};

export function CopilotChat({
  instructions,
  suggestions = "auto",
  onSubmitMessage,
  makeSystemMessage,
  disableSystemMessage,
  onInProgress,
  onStopGeneration,
  onReloadMessages,
  onRegenerate,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  markdownTagRenderers,
  Messages = DefaultMessages,
  RenderMessage = DefaultRenderMessage,
  RenderSuggestionsList = DefaultRenderSuggestionsList,
  Input = DefaultInput,
  className,
  icons,
  labels,
  AssistantMessage = DefaultAssistantMessage,
  UserMessage = DefaultUserMessage,
  ImageRenderer = DefaultImageRenderer,
  ErrorMessage,
  imageUploadsEnabled,
  inputFileAccept = "image/*",
  attachments,
  hideStopButton,
  observabilityHooks,
  renderError,
  onError,
  // Legacy props - deprecated
  RenderTextMessage,
  RenderActionExecutionMessage,
  RenderAgentStateMessage,
  RenderResultMessage,
  RenderImageMessage,
}: CopilotChatProps) {
  const {
    additionalInstructions,
    setChatInstructions,
    copilotApiConfig,
    setBannerError,
    setInternalErrorHandler,
    removeInternalErrorHandler,
  } = useCopilotContext();

  // Destructure stable values to avoid object reference changes
  const { publicApiKey, chatApiEndpoint } = copilotApiConfig;

  // Resolve attachments config with deprecation bridge
  const resolvedAttachments: AttachmentsConfig | undefined = (() => {
    if (attachments) return attachments;
    if (imageUploadsEnabled) {
      deprecationWarning(
        "imageUploadsEnabled",
        "imageUploadsEnabled is deprecated. Use attachments={{ enabled: true }} instead. " +
          "See https://docs.copilotkit.ai/migration-guides/migrate-attachments",
      );
      return { enabled: true, accept: inputFileAccept || "image/*" };
    }
    return undefined;
  })();

  const attachmentsEnabled = resolvedAttachments?.enabled ?? false;
  const attachmentsAccept = resolvedAttachments?.accept ?? "*/*";
  const attachmentsMaxSize = resolvedAttachments?.maxSize ?? 20 * 1024 * 1024;

  const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>(
    [],
  );
  const [dragOver, setDragOver] = useState(false);
  const processFilesRef = useRef<(files: File[]) => Promise<void>>(
    async () => {},
  );

  const [chatError, setChatError] = useState<ChatError | null>(null);
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, "thumbsUp" | "thumbsDown">
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper function to trigger event hooks only if publicApiKey is provided
  const triggerObservabilityHook = useCallback(
    (hookName: keyof CopilotObservabilityHooks, ...args: any[]) => {
      if (publicApiKey && observabilityHooks?.[hookName]) {
        (observabilityHooks[hookName] as any)(...args);
      }
      if (observabilityHooks?.[hookName] && !publicApiKey) {
        setBannerError(
          new CopilotKitError({
            message: "observabilityHooks requires a publicApiKey to function.",
            code: CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR,
            severity: Severity.CRITICAL,
            visibility: ErrorVisibility.BANNER,
          }),
        );
        styledConsole.publicApiKeyRequired("observabilityHooks");
      }
    },
    [publicApiKey, observabilityHooks, setBannerError],
  );

  // Helper function to trigger chat error and render error UI
  const triggerChatError = useCallback(
    (error: any, operation: string, originalError?: any) => {
      const errorMessage =
        error?.message || error?.toString() || "An error occurred";

      console.error(
        `[CopilotKit] ${operation} error:`,
        errorMessage,
        originalError ?? error,
      );

      // Set chat error state for rendering
      setChatError({
        message: errorMessage,
        operation,
        timestamp: Date.now(),
      });

      const errorEvent: CopilotErrorEvent = {
        type: "error",
        timestamp: Date.now(),
        context: {
          source: "ui",
          request: {
            operation,
            url: chatApiEndpoint,
            startTime: Date.now(),
          },
          technical: {
            environment: "browser",
            userAgent:
              typeof navigator !== "undefined"
                ? navigator.userAgent
                : undefined,
            stackTrace:
              originalError instanceof Error ? originalError.stack : undefined,
          },
        },
        error,
      };

      if (onError) {
        onError(errorEvent);
      }

      // Also trigger observability hook if available
      if (publicApiKey && observabilityHooks?.onError) {
        observabilityHooks.onError(errorEvent);
      }

      // Show banner error if onError hook is used without publicApiKey
      if (observabilityHooks?.onError && !publicApiKey) {
        setBannerError(
          new CopilotKitError({
            message:
              "observabilityHooks.onError requires a publicApiKey to function.",
            code: CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR,
            severity: Severity.CRITICAL,
            visibility: ErrorVisibility.BANNER,
          }),
        );
        styledConsole.publicApiKeyRequired("observabilityHooks.onError");
      }
    },
    [publicApiKey, chatApiEndpoint, observabilityHooks, setBannerError],
  );

  useEffect(() => {
    const id = "chat-component";
    setInternalErrorHandler({
      [id]: (error: CopilotErrorEvent) => {
        if (!error) return;
        triggerChatError(error.error, "sendMessage");
      },
    });
    return () => {
      // unregister when this instance unmounts
      removeInternalErrorHandler?.(id);
    };
  }, [triggerChatError, setInternalErrorHandler, removeInternalErrorHandler]);

  // Clipboard paste handler
  useEffect(() => {
    if (!attachmentsEnabled) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (!target.parentElement?.classList.contains("copilotKitInput")) return;

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
        triggerChatError(error, "pasteUpload", error);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [
    attachmentsEnabled,
    attachmentsAccept,
    attachmentsMaxSize,
    triggerChatError,
  ]);

  useEffect(() => {
    if (!additionalInstructions?.length) {
      setChatInstructions(instructions || "");
      return;
    }

    /*
      Will result in a prompt like:

      You are a helpful assistant. 
      Additionally, follow these instructions:
      - Do not answer questions about the weather.
      - Do not answer questions about the stock market."
    */
    const combinedAdditionalInstructions = [
      instructions,
      "Additionally, follow these instructions:",
      ...additionalInstructions.map((instruction) => `- ${instruction}`),
    ];

    setChatInstructions(combinedAdditionalInstructions.join("\n") || "");
  }, [instructions, additionalInstructions]);

  const {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    reloadMessages,
    suggestions: currentSuggestions,
    isLoadingSuggestions,
    agent,
  } = useCopilotChatInternal({
    suggestions,
    onInProgress,
    onSubmitMessage,
    onStopGeneration,
    onReloadMessages,
  });
  // makeSystemMessage,
  // disableSystemMessage,

  // Track loading state changes for chat start/stop events
  const prevIsLoading = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoading.current !== isLoading) {
      if (isLoading) {
        triggerObservabilityHook("onChatStarted");
      } else {
        triggerObservabilityHook("onChatStopped");
      }
      prevIsLoading.current = isLoading;
    }
  }, [isLoading, triggerObservabilityHook]);

  // Wrapper for sendMessage to clear selected attachments and build multimodal content
  const handleSendMessage = (text: string) => {
    const hasUploading = selectedAttachments.some(
      (a) => a.status === "uploading",
    );
    if (hasUploading) {
      triggerChatError(
        new Error("Attachment(s) still uploading. Please wait."),
        "sendMessage",
      );
      // Return a promise that resolves to a dummy message to satisfy the return type
      return Promise.resolve({
        id: randomUUID(),
        content: text,
        role: "user" as const,
      } as Message);
    }

    const currentAttachments = selectedAttachments.filter(
      (a) => a.status === "ready",
    );
    setSelectedAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Trigger message sent event
    triggerObservabilityHook("onMessageSent", text);

    // Build content: if we have attachments, use InputContent[]
    if (currentAttachments.length > 0) {
      const contentParts: InputContent[] = [];

      if (text.trim()) {
        contentParts.push({ type: "text", text });
      }

      for (const attachment of currentAttachments) {
        contentParts.push({
          type: attachment.type,
          source: attachment.source,
          metadata: {
            ...(attachment.filename ? { filename: attachment.filename } : {}),
            ...attachment.metadata,
          },
        } as InputContent);
      }

      return sendMessage({
        id: randomUUID(),
        content: contentParts,
        role: "user",
      });
    }

    // Plain text message
    return sendMessage({
      id: randomUUID(),
      content: text,
      role: "user",
    });
  };

  const chatContext = React.useContext(ChatContext);
  const isVisible = chatContext ? chatContext.open : true;

  const handleRegenerate = (messageId: string) => {
    if (onRegenerate) {
      onRegenerate(messageId);
    }

    // Trigger message regenerated event
    triggerObservabilityHook("onMessageRegenerated", messageId);

    reloadMessages(messageId);
  };

  const handleCopy = (message: string) => {
    if (onCopy) {
      onCopy(message);
    }

    // Trigger message copied event
    triggerObservabilityHook("onMessageCopied", message);
  };

  const processFiles = async (files: File[]) => {
    const validFiles = files.filter((file) =>
      matchesAcceptFilter(file, attachmentsAccept),
    );
    const rejectedFiles = files.filter(
      (file) => !matchesAcceptFilter(file, attachmentsAccept),
    );
    for (const file of rejectedFiles) {
      const message = `File "${file.name}" is not accepted. Supported types: ${attachmentsAccept}`;
      triggerChatError(new Error(message), "fileUpload");
      resolvedAttachments?.onUploadFailed?.({
        reason: "invalid-type",
        file,
        message,
      });
    }

    for (const file of validFiles) {
      if (exceedsMaxSize(file, attachmentsMaxSize)) {
        const message = `File "${file.name}" exceeds the maximum size of ${formatFileSize(attachmentsMaxSize)}`;
        triggerChatError(new Error(message), "fileUpload");
        resolvedAttachments?.onUploadFailed?.({
          reason: "file-too-large",
          file,
          message,
        });
        continue;
      }

      const modality = getModalityFromMimeType(file.type);

      // Use a unique ID to track this placeholder across concurrent uploads
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

        if (resolvedAttachments?.onUpload) {
          const { metadata: meta, ...uploadSource } =
            await resolvedAttachments.onUpload(file);
          source = uploadSource;
          uploadMetadata = meta;
        } else {
          const base64 = await readFileAsBase64(file);
          source = { type: "data", value: base64, mimeType: file.type };
        }

        // Generate video thumbnail if applicable
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
        // Remove the failed placeholder
        setSelectedAttachments((prev) =>
          prev.filter((att) => att.id !== placeholderId),
        );
        const message = error instanceof Error ? error.message : String(error);
        triggerChatError(
          new Error(`Failed to upload "${file.name}": ${message}`),
          "fileUpload",
          error,
        );
        resolvedAttachments?.onUploadFailed?.({
          reason: "upload-failed",
          file,
          message: `Failed to upload "${file.name}": ${message}`,
        });
      }
    }
  };
  processFilesRef.current = processFiles;

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!event.target.files || event.target.files.length === 0) return;
    try {
      await processFiles(Array.from(event.target.files));
    } catch (error) {
      triggerChatError(error, "fileUpload", error);
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
        triggerChatError(error, "dropUpload", error);
      }
    }
  };

  const handleThumbsUp = (message: Message) => {
    if (onThumbsUp) {
      onThumbsUp(message);
    }

    // Update feedback state
    setMessageFeedback((prev) => ({
      ...prev,
      [message.id]: "thumbsUp",
    }));

    // Trigger feedback given event
    triggerObservabilityHook("onFeedbackGiven", message.id, "thumbsUp");
  };

  const handleThumbsDown = (message: Message) => {
    if (onThumbsDown) {
      onThumbsDown(message);
    }

    // Update feedback state
    setMessageFeedback((prev) => ({
      ...prev,
      [message.id]: "thumbsDown",
    }));

    // Trigger feedback given event
    triggerObservabilityHook("onFeedbackGiven", message.id, "thumbsDown");
  };

  return (
    <WrappedCopilotChat icons={icons} labels={labels} className={className}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`copilotKitChatBody${dragOver ? " copilotKitDragOver" : ""}`}
      >
        {/* Render error above messages if present */}
        {chatError &&
          renderError &&
          renderError({
            ...chatError,
            onDismiss: () => setChatError(null),
            onRetry: () => {
              // Clear error and potentially retry based on operation
              setChatError(null);
              // TODO: Implement specific retry logic based on operation type
            },
          })}

        <Messages
          AssistantMessage={AssistantMessage}
          UserMessage={UserMessage}
          RenderMessage={RenderMessage}
          messages={messages}
          inProgress={isLoading}
          onRegenerate={handleRegenerate}
          onCopy={handleCopy}
          onThumbsUp={handleThumbsUp}
          onThumbsDown={handleThumbsDown}
          messageFeedback={messageFeedback}
          markdownTagRenderers={markdownTagRenderers}
          ImageRenderer={ImageRenderer}
          ErrorMessage={ErrorMessage}
          chatError={chatError}
          // Legacy props - passed through to Messages component
          RenderTextMessage={RenderTextMessage}
          RenderActionExecutionMessage={RenderActionExecutionMessage}
          RenderAgentStateMessage={RenderAgentStateMessage}
          RenderResultMessage={RenderResultMessage}
          RenderImageMessage={RenderImageMessage}
        >
          {currentSuggestions.length > 0 && (
            <RenderSuggestionsList
              onSuggestionClick={handleSendMessage}
              suggestions={currentSuggestions}
              isLoading={isLoadingSuggestions}
            />
          )}
        </Messages>

        {attachmentsEnabled && (
          <>
            <AttachmentQueue
              attachments={selectedAttachments}
              onRemoveAttachment={(id) =>
                setSelectedAttachments((prev) =>
                  prev.filter((att) => att.id !== id),
                )
              }
            />
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept={attachmentsAccept}
              style={{ display: "none" }}
            />
          </>
        )}
        <Input
          inProgress={isLoading}
          chatReady={Boolean(agent)}
          // @ts-ignore
          onSend={handleSendMessage}
          isVisible={isVisible}
          onStop={stopGeneration}
          onUpload={
            attachmentsEnabled ? () => fileInputRef.current?.click() : undefined
          }
          hideStopButton={hideStopButton}
        />
      </div>
    </WrappedCopilotChat>
  );
}

export function WrappedCopilotChat({
  children,
  icons,
  labels,
  className,
}: {
  children: React.ReactNode;
  icons?: CopilotChatIcons;
  labels?: CopilotChatLabels;
  className?: string;
}) {
  const chatContext = React.useContext(ChatContext);
  if (!chatContext) {
    return (
      <ChatContextProvider
        icons={icons}
        labels={labels}
        open={true}
        setOpen={() => {}}
      >
        <div className={`copilotKitChat ${className ?? ""}`}>{children}</div>
      </ChatContextProvider>
    );
  }
  return <>{children}</>;
}
