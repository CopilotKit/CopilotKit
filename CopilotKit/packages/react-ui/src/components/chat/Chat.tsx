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
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  SystemMessageFunction,
  useCopilotChatInternal as useCopilotChat,
  useCopilotContext,
  useCopilotMessagesContext,
} from "@copilotkit/react-core";
import type { SuggestionItem } from "@copilotkit/react-core";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotErrorEvent,
  Message,
  Severity,
  ErrorVisibility,
  styledConsole,
} from "@copilotkit/shared";
import { randomId } from "@copilotkit/shared";
import {
  AssistantMessageProps,
  ComponentsMap,
  CopilotObservabilityHooks,
  ImageRendererProps,
  InputProps,
  MessagesProps,
  RenderMessageProps,
  RenderSuggestionsListProps,
  UserMessageProps,
} from "./props";

import { HintFunction, runAgent, stopAgent } from "@copilotkit/react-core";
import { ImageUploadQueue } from "./ImageUploadQueue";
import { Suggestions as DefaultRenderSuggestionsList } from "./Suggestions";

/**
 * The type of suggestions to use in the chat.
 *
 * `auto` - Suggestions are generated automatically.
 * `manual` - Suggestions are controlled programmatically.
 * `SuggestionItem[]` - Static suggestions array.
 */
export type ChatSuggestions = "auto" | "manual" | SuggestionItem[];

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
   * Enable image upload button (image inputs only supported on some models)
   */
  imageUploadsEnabled?: boolean;

  /**
   * The 'accept' attribute for the file input used for image uploads.
   * Defaults to "image/*".
   */
  inputFileAccept?: string;

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
}

interface OnStopGenerationArguments {
  /**
   * The name of the currently executing agent.
   */
  currentAgentName: string | undefined;

  /**
   * The messages in the chat.
   */
  messages: Message[];

  /**
   * Set the messages in the chat.
   */
  setMessages: (messages: Message[]) => void;

  /**
   * Stop chat generation.
   */
  stopGeneration: () => void;

  /**
   * Restart the currently executing agent.
   */
  restartCurrentAgent: () => void;

  /**
   * Stop the currently executing agent.
   */
  stopCurrentAgent: () => void;

  /**
   * Run the currently executing agent.
   */
  runCurrentAgent: (hint?: HintFunction) => Promise<void>;

  /**
   * Set the state of the currently executing agent.
   */
  setCurrentAgentState: (state: any) => void;
}

export type OnReloadMessagesArguments = OnStopGenerationArguments & {
  /**
   * The message on which "regenerate" was pressed
   */
  messageId: string;
};

export type OnStopGeneration = (args: OnStopGenerationArguments) => void;

export type OnReloadMessages = (args: OnReloadMessagesArguments) => void;

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
  imageUploadsEnabled,
  inputFileAccept = "image/*",
  hideStopButton,
  observabilityHooks,
  renderError,

  // Legacy props - deprecated
  RenderTextMessage,
  RenderActionExecutionMessage,
  RenderAgentStateMessage,
  RenderResultMessage,
  RenderImageMessage,
}: CopilotChatProps) {
  const { additionalInstructions, setChatInstructions, copilotApiConfig, setBannerError } =
    useCopilotContext();

  // Destructure stable values to avoid object reference changes
  const { publicApiKey, chatApiEndpoint } = copilotApiConfig;
  const [selectedImages, setSelectedImages] = useState<Array<ImageUpload>>([]);
  const [chatError, setChatError] = useState<{
    message: string;
    operation?: string;
    timestamp: number;
  } | null>(null);
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
      const errorMessage = error?.message || error?.toString() || "An error occurred";

      // Set chat error state for rendering
      setChatError({
        message: errorMessage,
        operation,
        timestamp: Date.now(),
      });

      // Also trigger observability hook if available
      if (publicApiKey && observabilityHooks?.onError) {
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
              userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
              stackTrace: originalError instanceof Error ? originalError.stack : undefined,
            },
          },
          error,
        };
        observabilityHooks.onError(errorEvent);
      }

      // Show banner error if onError hook is used without publicApiKey
      if (observabilityHooks?.onError && !publicApiKey) {
        setBannerError(
          new CopilotKitError({
            message: "observabilityHooks.onError requires a publicApiKey to function.",
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

  // Clipboard paste handler
  useEffect(() => {
    if (!imageUploadsEnabled) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (!target.parentElement?.classList.contains("copilotKitInput")) return;

      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      if (imageItems.length === 0) return;

      e.preventDefault(); // Prevent default paste behavior for images

      const imagePromises: Promise<ImageUpload | null>[] = imageItems.map((item) => {
        const file = item.getAsFile();
        if (!file) return Promise.resolve(null);

        return new Promise<ImageUpload | null>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64String = (e.target?.result as string)?.split(",")[1];
            if (base64String) {
              resolve({
                contentType: file.type,
                bytes: base64String,
              });
            } else {
              resolve(null);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      });

      try {
        const loadedImages = (await Promise.all(imagePromises)).filter((img) => img !== null);
        setSelectedImages((prev) => [...prev, ...loadedImages]);
      } catch (error) {
        // Trigger chat-level error handler
        triggerChatError(error, "processClipboardImages", error);
        console.error("Error processing pasted images:", error);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [imageUploadsEnabled, triggerChatError]);

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
  } = useCopilotChatLogic(
    suggestions,
    makeSystemMessage,
    disableSystemMessage,
    onInProgress,
    onSubmitMessage,
    onStopGeneration,
    onReloadMessages,
  );

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

  // Wrapper for sendMessage to clear selected images
  const handleSendMessage = (text: string) => {
    const images = selectedImages;
    setSelectedImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Trigger message sent event
    triggerObservabilityHook("onMessageSent", text);

    return sendMessage(text, images);
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

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }

    const files = Array.from(event.target.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;

    const fileReadPromises = files.map((file) => {
      return new Promise<{ contentType: string; bytes: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64String = (e.target?.result as string)?.split(",")[1] || "";
          if (base64String) {
            resolve({
              contentType: file.type,
              bytes: base64String,
            });
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });

    try {
      const loadedImages = await Promise.all(fileReadPromises);
      setSelectedImages((prev) => [...prev, ...loadedImages]);
    } catch (error) {
      // Trigger chat-level error handler
      triggerChatError(error, "processUploadedImages", error);
      console.error("Error reading files:", error);
    }
  };

  const removeSelectedImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleThumbsUp = (message: Message) => {
    if (onThumbsUp) {
      onThumbsUp(message);
    }

    // Trigger feedback given event
    triggerObservabilityHook("onFeedbackGiven", message.id, "thumbsUp");
  };

  const handleThumbsDown = (message: Message) => {
    if (onThumbsDown) {
      onThumbsDown(message);
    }

    // Trigger feedback given event
    triggerObservabilityHook("onFeedbackGiven", message.id, "thumbsDown");
  };

  return (
    <WrappedCopilotChat icons={icons} labels={labels} className={className}>
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
        markdownTagRenderers={markdownTagRenderers}
        ImageRenderer={ImageRenderer}
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
          />
        )}
      </Messages>

      {imageUploadsEnabled && (
        <>
          <ImageUploadQueue images={selectedImages} onRemoveImage={removeSelectedImage} />
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept={inputFileAccept}
            style={{ display: "none" }}
          />
        </>
      )}
      <Input
        inProgress={isLoading}
        onSend={handleSendMessage}
        isVisible={isVisible}
        onStop={stopGeneration}
        onUpload={imageUploadsEnabled ? () => fileInputRef.current?.click() : undefined}
        hideStopButton={hideStopButton}
      />
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
      <ChatContextProvider icons={icons} labels={labels} open={true} setOpen={() => {}}>
        <div className={`copilotKitChat ${className ?? ""}`}>{children}</div>
      </ChatContextProvider>
    );
  }
  return <>{children}</>;
}

export const useCopilotChatLogic = (
  chatSuggestions: ChatSuggestions,
  makeSystemMessage?: SystemMessageFunction,
  disableSystemMessage?: boolean,
  onInProgress?: (isLoading: boolean) => void,
  onSubmitMessage?: (messageContent: string) => Promise<void> | void,
  onStopGeneration?: OnStopGeneration,
  onReloadMessages?: OnReloadMessages,
) => {
  const {
    messages,
    sendMessage,
    setMessages,
    reloadMessages: defaultReloadMessages,
    stopGeneration: defaultStopGeneration,
    runChatCompletion,
    isLoading,
    suggestions,
    setSuggestions,
    generateSuggestions,
    resetSuggestions: resetSuggestionsFromHook,
    isLoadingSuggestions,
  } = useCopilotChat({
    makeSystemMessage,
    disableSystemMessage,
  });

  const generalContext = useCopilotContext();
  const messagesContext = useCopilotMessagesContext();

  // Get actions from context for message conversion
  const { actions } = generalContext;

  // Suggestion state management
  const [suggestionsFailed, setSuggestionsFailed] = useState(false);
  const hasGeneratedInitialSuggestions = useRef<boolean>(false);

  // Handle static suggestions (when suggestions prop is an array)
  useEffect(() => {
    if (Array.isArray(chatSuggestions)) {
      setSuggestions(chatSuggestions);
      hasGeneratedInitialSuggestions.current = true;
    }
  }, [JSON.stringify(chatSuggestions), setSuggestions]);

  // Error handling wrapper
  const generateSuggestionsWithErrorHandling = useCallback(
    async (context: string) => {
      try {
        await generateSuggestions();
      } catch (error) {
        console.error("Failed to generate suggestions:", error);
        setSuggestionsFailed(true);
      }
    },
    [generateSuggestions],
  );

  // Automatic suggestion generation logic
  useEffect(() => {
    // Only proceed if in auto mode, not currently loading, and not failed
    if (chatSuggestions !== "auto" || isLoadingSuggestions || suggestionsFailed) {
      return;
    }

    // Don't run during chat loading (when the assistant is responding)
    if (isLoading) {
      return;
    }

    // Check if we have any configurations
    if (Object.keys(generalContext.chatSuggestionConfiguration).length === 0) {
      return;
    }

    // Generate initial suggestions when chat is empty
    if (messages.length === 0 && !hasGeneratedInitialSuggestions.current) {
      hasGeneratedInitialSuggestions.current = true;
      generateSuggestionsWithErrorHandling("initial");
      return;
    }

    // Generate post-message suggestions after assistant responds
    if (messages.length > 0 && suggestions.length === 0) {
      generateSuggestionsWithErrorHandling("post-message");
      return;
    }
  }, [
    chatSuggestions,
    isLoadingSuggestions,
    suggestionsFailed,
    messages.length,
    isLoading,
    suggestions.length,
    Object.keys(generalContext.chatSuggestionConfiguration).join(","), // Use stable string instead of object reference
    generateSuggestionsWithErrorHandling,
  ]);

  // Reset suggestion state when switching away from auto mode
  useEffect(() => {
    if (chatSuggestions !== "auto") {
      hasGeneratedInitialSuggestions.current = false;
      setSuggestionsFailed(false);
    }
  }, [chatSuggestions]);

  // Memoize context to prevent infinite re-renders
  const stableContext = useMemo(
    () => ({
      ...generalContext,
      ...messagesContext,
    }),
    [
      // Only include stable dependencies
      generalContext.actions,
      messagesContext.messages.length,
      generalContext.isLoading,
    ],
  );

  // Wrapper for resetSuggestions that also resets local state
  const resetSuggestions = useCallback(() => {
    resetSuggestionsFromHook();
    setSuggestionsFailed(false);
    hasGeneratedInitialSuggestions.current = false;
  }, [resetSuggestionsFromHook]);

  useEffect(() => {
    onInProgress?.(isLoading);
  }, [onInProgress, isLoading]);

  const safelySendMessage = async (
    messageContent: string,
    imagesToUse?: Array<{ contentType: string; bytes: string }>,
  ) => {
    const images = imagesToUse || [];

    // Clear existing suggestions when user sends a message
    // This prevents stale suggestions from remaining visible during new conversation flow
    if (chatSuggestions === "auto" || chatSuggestions === "manual") {
      setSuggestions([]);
    }

    let firstMessage: Message | null = null;

    // Send text message if content provided
    if (messageContent.trim().length > 0) {
      const textMessage: Message = {
        id: randomId(),
        role: "user",
        content: messageContent,
      };

      // Call user-provided submit handler if available
      if (onSubmitMessage) {
        try {
          await onSubmitMessage(messageContent);
        } catch (error) {
          console.error("Error in onSubmitMessage:", error);
        }
      }

      // Send the message and clear suggestions for auto/manual modes
      await sendMessage(textMessage, {
        followUp: images.length === 0,
        clearSuggestions: chatSuggestions === "auto" || chatSuggestions === "manual",
      });

      if (!firstMessage) {
        firstMessage = textMessage;
      }
    }

    // Send image messages
    if (images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const imageMessage = {
          id: randomId(),
          role: "user" as const,
          image: {
            format: images[i].contentType.replace("image/", ""),
            bytes: images[i].bytes,
          },
        } as unknown as Message;
        await sendMessage(imageMessage, { followUp: i === images.length - 1 });
        if (!firstMessage) {
          firstMessage = imageMessage;
        }
      }
    }

    if (!firstMessage) {
      // Should not happen if send button is properly disabled, but handle just in case
      return { role: "user", content: "", id: randomId() } as Message; // Return a dummy message
    }

    // The hook implicitly triggers API call on appendMessage.
    // We return the first message sent (either text or first image)
    return firstMessage;
  };

  const currentAgentName = generalContext.agentSession?.agentName;
  const restartCurrentAgent = async (hint?: HintFunction) => {
    if (generalContext.agentSession) {
      generalContext.setAgentSession({
        ...generalContext.agentSession,
        nodeName: undefined,
        threadId: undefined,
      });
      generalContext.setCoagentStates((prevAgentStates) => {
        return {
          ...prevAgentStates,
          [generalContext.agentSession!.agentName]: {
            ...prevAgentStates[generalContext.agentSession!.agentName],
            threadId: undefined,
            nodeName: undefined,
            runId: undefined,
          },
        };
      });
    }
  };
  const runCurrentAgent = async (hint?: HintFunction) => {
    if (generalContext.agentSession) {
      await runAgent(
        generalContext.agentSession.agentName,
        stableContext,
        messagesContext.messages,
        sendMessage,
        runChatCompletion,
      );
    }
  };
  const stopCurrentAgent = () => {
    if (generalContext.agentSession) {
      stopAgent(generalContext.agentSession.agentName, stableContext);
    }
  };
  const setCurrentAgentState = (state: any) => {
    if (generalContext.agentSession) {
      generalContext.setCoagentStates((prevAgentStates) => {
        return {
          ...prevAgentStates,
          [generalContext.agentSession!.agentName]: {
            state,
          },
        } as any;
      });
    }
  };

  function stopGeneration() {
    // Clear suggestions when stopping generation
    setSuggestions([]);

    if (onStopGeneration) {
      onStopGeneration({
        messages: messages,
        setMessages,
        stopGeneration: defaultStopGeneration,
        currentAgentName,
        restartCurrentAgent,
        stopCurrentAgent,
        runCurrentAgent,
        setCurrentAgentState,
      });
    } else {
      defaultStopGeneration();
    }
  }
  function reloadMessages(messageId: string) {
    if (onReloadMessages) {
      onReloadMessages({
        messages: messages,
        setMessages,
        stopGeneration: defaultStopGeneration,
        currentAgentName,
        restartCurrentAgent,
        stopCurrentAgent,
        runCurrentAgent,
        setCurrentAgentState,
        messageId,
      });
    } else {
      defaultReloadMessages(messageId);
    }
  }

  return {
    messages,
    isLoading,
    suggestions,
    sendMessage: safelySendMessage,
    stopGeneration,
    reloadMessages,
    resetSuggestions,
    context: stableContext,
    actions,
  };
};
