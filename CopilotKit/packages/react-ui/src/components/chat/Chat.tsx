/**
 * <br/>
 * <img src="/images/CopilotChat.gif" width="500" />
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
import { RenderTextMessage as DefaultRenderTextMessage } from "./messages/RenderTextMessage";
import { RenderActionExecutionMessage as DefaultRenderActionExecutionMessage } from "./messages/RenderActionExecutionMessage";
import { RenderResultMessage as DefaultRenderResultMessage } from "./messages/RenderResultMessage";
import { RenderAgentStateMessage as DefaultRenderAgentStateMessage } from "./messages/RenderAgentStateMessage";
import { RenderImageMessage as DefaultRenderImageMessage } from "./messages/RenderImageMessage";
import { AssistantMessage as DefaultAssistantMessage } from "./messages/AssistantMessage";
import { UserMessage as DefaultUserMessage } from "./messages/UserMessage";
import { Suggestion } from "./Suggestion";
import React, { useEffect, useRef, useState } from "react";
import {
  SystemMessageFunction,
  useCopilotChat,
  useCopilotContext,
  useCopilotMessagesContext,
} from "@copilotkit/react-core";
import { reloadSuggestions } from "./Suggestion";
import { CopilotChatSuggestion } from "../../types/suggestions";
import { Message, Role, TextMessage, ImageMessage } from "@copilotkit/runtime-client-gql";
import { randomId } from "@copilotkit/shared";
import {
  AssistantMessageProps,
  InputProps,
  MessagesProps,
  RenderMessageProps,
  UserMessageProps,
} from "./props";

import { HintFunction, runAgent, stopAgent } from "@copilotkit/react-core";
import { ImageUploadQueue } from "./ImageUploadQueue";

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
  onThumbsUp?: (message: string) => void;

  /**
   * A callback function for thumbs down feedback
   */
  onThumbsDown?: (message: string) => void;

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
   * A custom RenderTextMessage component to use instead of the default.
   */
  RenderTextMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * A custom RenderActionExecutionMessage component to use instead of the default.
   */
  RenderActionExecutionMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * A custom RenderAgentStateMessage component to use instead of the default.
   */
  RenderAgentStateMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * A custom RenderResultMessage component to use instead of the default.
   */
  RenderResultMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * A custom RenderImageMessage component to use instead of the default.
   */
  RenderImageMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * A custom Input component to use instead of the default.
   */
  Input?: React.ComponentType<InputProps>;

  /**
   * A class name to apply to the root element.
   */
  className?: string;

  /**
   * Children to render.
   */
  children?: React.ReactNode;
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
  onSubmitMessage,
  makeSystemMessage,
  onInProgress,
  onStopGeneration,
  onReloadMessages,
  onRegenerate,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  Messages = DefaultMessages,
  RenderTextMessage = DefaultRenderTextMessage,
  RenderActionExecutionMessage = DefaultRenderActionExecutionMessage,
  RenderAgentStateMessage = DefaultRenderAgentStateMessage,
  RenderResultMessage = DefaultRenderResultMessage,
  RenderImageMessage = DefaultRenderImageMessage,
  Input = DefaultInput,
  className,
  icons,
  labels,
  AssistantMessage = DefaultAssistantMessage,
  UserMessage = DefaultUserMessage,
  imageUploadsEnabled,
  inputFileAccept = "image/*",
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

    console.log("combinedAdditionalInstructions", combinedAdditionalInstructions);

    setChatInstructions(combinedAdditionalInstructions.join("\n") || "");
  }, [instructions, additionalInstructions]);

  const {
    visibleMessages,
    isLoading,
    currentSuggestions,
    sendMessage,
    stopGeneration,
    reloadMessages,
  } = useCopilotChatLogic(
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
        RenderTextMessage={RenderTextMessage}
        RenderActionExecutionMessage={RenderActionExecutionMessage}
        RenderAgentStateMessage={RenderAgentStateMessage}
        RenderResultMessage={RenderResultMessage}
        RenderImageMessage={RenderImageMessage}
        messages={visibleMessages}
        inProgress={isLoading}
        onRegenerate={handleRegenerate}
        onCopy={handleCopy}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
      >
        {currentSuggestions.length > 0 && (
          <div className="suggestions">
            {currentSuggestions.map((suggestion, index) => (
              <Suggestion
                key={index}
                title={suggestion.title}
                message={suggestion.message}
                partial={suggestion.partial}
                className={suggestion.className}
                onClick={(message) => handleSendMessage(message)}
              />
            ))}
          </div>
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

const SUGGESTIONS_DEBOUNCE_TIMEOUT = 1000;

export const useCopilotChatLogic = (
  makeSystemMessage?: SystemMessageFunction,
  onInProgress?: (isLoading: boolean) => void,
  onSubmitMessage?: (messageContent: string) => Promise<void> | void,
  onStopGeneration?: OnStopGeneration,
  onReloadMessages?: OnReloadMessages,
) => {
  const {
    visibleMessages,
    appendMessage,
    reloadMessages: defaultReloadMessages,
    stopGeneration: defaultStopGeneration,
    runChatCompletion,
    isLoading,
  } = useCopilotChat({
    id: randomId(),
    makeSystemMessage,
  });

  const [currentSuggestions, setCurrentSuggestions] = useState<CopilotChatSuggestion[]>([]);
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<any>();

  const abortSuggestions = () => {
    suggestionsAbortControllerRef.current?.abort();
    suggestionsAbortControllerRef.current = null;
  };

  const generalContext = useCopilotContext();
  const messagesContext = useCopilotMessagesContext();
  const context = { ...generalContext, ...messagesContext };

  useEffect(() => {
    onInProgress?.(isLoading);

    abortSuggestions();

    debounceTimerRef.current = setTimeout(
      () => {
        if (!isLoading && Object.keys(context.chatSuggestionConfiguration).length !== 0) {
          suggestionsAbortControllerRef.current = new AbortController();
          reloadSuggestions(
            context,
            context.chatSuggestionConfiguration,
            setCurrentSuggestions,
            suggestionsAbortControllerRef,
          );
        }
      },
      currentSuggestions.length == 0 ? 0 : SUGGESTIONS_DEBOUNCE_TIMEOUT,
    );

    return () => {
      clearTimeout(debounceTimerRef.current);
    };
  }, [
    isLoading,
    context.chatSuggestionConfiguration,
    // hackish way to trigger suggestions reload on reset, but better than moving suggestions to the
    // global context
    visibleMessages.length == 0,
  ]);

  const sendMessage = async (
    messageContent: string,
    imagesToUse?: Array<{ contentType: string; bytes: string }>,
  ) => {
    // Use images passed in the call OR the ones from the state (passed via props)
    const images = imagesToUse || [];

    abortSuggestions();
    setCurrentSuggestions([]);

    let firstMessage: Message | null = null;

    // If there's text content, send a text message first
    if (messageContent.trim().length > 0) {
      const textMessage = new TextMessage({
        content: messageContent,
        role: Role.User,
      });

      if (onSubmitMessage) {
        try {
          // Call onSubmitMessage only with text, as image handling is internal right now
          await onSubmitMessage(messageContent);
        } catch (error) {
          console.error("Error in onSubmitMessage:", error);
        }
      }

      await appendMessage(textMessage, { followUp: images.length === 0 });

      if (!firstMessage) {
        firstMessage = textMessage;
      }
    }

    // Send image messages
    if (images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const imageMessage = new ImageMessage({
          format: images[i].contentType.replace("image/", ""),
          bytes: images[i].bytes,
          role: Role.User,
        });
        await appendMessage(imageMessage, { followUp: i === images.length - 1 });
        if (!firstMessage) {
          firstMessage = imageMessage;
        }
      }
    }

    if (!firstMessage) {
      // Should not happen if send button is properly disabled, but handle just in case
      return new TextMessage({ content: "", role: Role.User }); // Return a dummy message
    }

    // The hook implicitly triggers API call on appendMessage.
    // We return the first message sent (either text or first image)
    return firstMessage;
  };

  const messages = visibleMessages;
  const { setMessages } = messagesContext;
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
        context,
        appendMessage,
        runChatCompletion,
        hint,
      );
    }
  };
  const stopCurrentAgent = () => {
    if (generalContext.agentSession) {
      stopAgent(generalContext.agentSession.agentName, context);
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
    if (onStopGeneration) {
      onStopGeneration({
        messages,
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
        messages,
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
    visibleMessages,
    isLoading,
    currentSuggestions,
    sendMessage,
    stopGeneration,
    reloadMessages,
  };
};
