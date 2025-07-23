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
import { Message } from "@copilotkit/shared";
import { randomId } from "@copilotkit/shared";
import {
  AssistantMessageProps,
  ComponentsMap,
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
}: CopilotChatProps) {
  const { additionalInstructions, setChatInstructions } = useCopilotContext();
  const [selectedImages, setSelectedImages] = useState<Array<ImageUpload>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        // TODO: Show an error message to the user
        console.error("Error processing pasted images:", error);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [imageUploadsEnabled]);

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
    visibleMessages,
    isLoading,
    sendMessage,
    stopGeneration,
    reloadMessages,
    suggestions: currentSuggestions,
  } = useCopilotChatLogic(
    suggestions,
    makeSystemMessage,
    onInProgress,
    onSubmitMessage,
    onStopGeneration,
    onReloadMessages,
  );

  // Wrapper for sendMessage to clear selected images
  const handleSendMessage = (text: string) => {
    const images = selectedImages;
    setSelectedImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    return sendMessage(text, images);
  };

  const chatContext = React.useContext(ChatContext);
  const isVisible = chatContext ? chatContext.open : true;

  const handleRegenerate = (messageId: string) => {
    if (onRegenerate) {
      onRegenerate(messageId);
    }

    reloadMessages(messageId);
  };

  const handleCopy = (message: string) => {
    if (onCopy) {
      onCopy(message);
    }
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
      // TODO: Show an error message to the user
      console.error("Error reading files:", error);
    }
  };

  const removeSelectedImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <WrappedCopilotChat icons={icons} labels={labels} className={className}>
      <Messages
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        RenderMessage={RenderMessage}
        messages={visibleMessages}
        inProgress={isLoading}
        onRegenerate={handleRegenerate}
        onCopy={handleCopy}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
        markdownTagRenderers={markdownTagRenderers}
        ImageRenderer={ImageRenderer}
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
  onInProgress?: (isLoading: boolean) => void,
  onSubmitMessage?: (messageContent: string) => Promise<void> | void,
  onStopGeneration?: OnStopGeneration,
  onReloadMessages?: OnReloadMessages,
) => {
  const {
    visibleMessages,
    appendMessage,
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
    if (visibleMessages.length === 0 && !hasGeneratedInitialSuggestions.current) {
      hasGeneratedInitialSuggestions.current = true;
      generateSuggestionsWithErrorHandling("initial");
      return;
    }

    // Generate post-message suggestions after assistant responds
    if (visibleMessages.length > 0 && suggestions.length === 0) {
      generateSuggestionsWithErrorHandling("post-message");
      return;
    }
  }, [
    chatSuggestions,
    isLoadingSuggestions,
    suggestionsFailed,
    visibleMessages.length,
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

  const sendMessage = async (
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
      await appendMessage(textMessage, {
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
        await appendMessage(imageMessage, { followUp: i === images.length - 1 });
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

  const messages = visibleMessages;
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
        appendMessage,
        runChatCompletion,
        hint,
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
    visibleMessages,
    isLoading,
    suggestions,
    sendMessage,
    stopGeneration,
    reloadMessages,
    resetSuggestions,
    context: stableContext,
    actions,
  };
};
