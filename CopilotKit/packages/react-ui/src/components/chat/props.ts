import { AIMessage, Message, UserMessage, CopilotErrorEvent } from "@copilotkit/shared";
import { CopilotChatSuggestion } from "../../types/suggestions";
import { ReactNode } from "react";
import { ImageData } from "@copilotkit/shared";

/**
 * Event hooks for CopilotKit chat events.
 * These hooks only work when publicApiKey is provided.
 */
export interface CopilotObservabilityHooks {
  /**
   * Called when a message is sent by the user
   */
  onMessageSent?: (message: string) => void;

  /**
   * Called when the chat is minimized/closed
   */
  onChatMinimized?: () => void;

  /**
   * Called when the chat is expanded/opened
   */
  onChatExpanded?: () => void;

  /**
   * Called when a message is regenerated
   */
  onMessageRegenerated?: (messageId: string) => void;

  /**
   * Called when a message is copied
   */
  onMessageCopied?: (content: string) => void;

  /**
   * Called when feedback is given (thumbs up/down)
   */
  onFeedbackGiven?: (messageId: string, type: "thumbsUp" | "thumbsDown") => void;

  /**
   * Called when chat generation starts
   */
  onChatStarted?: () => void;

  /**
   * Called when chat generation stops
   */
  onChatStopped?: () => void;

  /**
   * Called when an error occurs in the chat
   * This enables chat-specific error handling UX while preserving system-wide error monitoring
   */
  onError?: (errorEvent: CopilotErrorEvent) => void;
}

export interface ButtonProps {}

export interface WindowProps {
  clickOutsideToClose: boolean;
  hitEscapeToClose: boolean;
  shortcut: string;
  children?: React.ReactNode;
}

export interface HeaderProps {}

export interface SuggestionsProps {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
  onClick: (message: string) => void;
}

export type ComponentsMap<T extends Record<string, object> = Record<string, object>> = {
  [K in keyof T]: React.FC<{ children?: ReactNode } & T[K]>;
};

export interface MessagesProps {
  messages: Message[];
  inProgress: boolean;
  children?: React.ReactNode;
  AssistantMessage: React.ComponentType<AssistantMessageProps>;
  UserMessage: React.ComponentType<UserMessageProps>;
  RenderMessage: React.ComponentType<RenderMessageProps>;
  ImageRenderer: React.ComponentType<ImageRendererProps>;

  /**
   * Callback function to regenerate the assistant's response
   */
  onRegenerate?: (messageId: string) => void;

  /**
   * Callback function when the message is copied
   */
  onCopy?: (message: string) => void;

  /**
   * Callback function for thumbs up feedback
   */
  onThumbsUp?: (message: Message) => void;

  /**
   * Callback function for thumbs down feedback
   */
  onThumbsDown?: (message: Message) => void;

  /**
   * A list of markdown components to render in assistant message.
   * Useful when you want to render custom elements in the message (e.g a reference tag element)
   */
  markdownTagRenderers?: ComponentsMap;

  /**
   * @deprecated Use RenderMessage instead
   */
  RenderTextMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated Use RenderMessage instead
   */
  RenderActionExecutionMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated Use RenderMessage instead
   */
  RenderAgentStateMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated Use RenderMessage instead
   */
  RenderResultMessage?: React.ComponentType<RenderMessageProps>;

  /**
   * @deprecated Use RenderMessage instead
   */
  RenderImageMessage?: React.ComponentType<RenderMessageProps>;
}

export interface Renderer {
  content: string;
}

export interface UserMessageProps {
  message?: UserMessage;
  ImageRenderer: React.ComponentType<ImageRendererProps>;

  /**
   * @deprecated use message instead
   *
   * The raw data from the assistant's response
   */
  rawData: any;
}

export interface AssistantMessageProps {
  /**
   * The message content from the assistant
   */

  message?: AIMessage;

  /**
   * Indicates if this is the last message
   */
  isCurrentMessage?: boolean;

  /**
   * Whether a response is loading, this is when the LLM is thinking of a response but hasn't finished yet.
   */
  isLoading: boolean;

  /**
   * Whether a response is generating, this is when the LLM is actively generating and streaming content.
   */
  isGenerating: boolean;

  /**
   * Callback function to regenerate the assistant's response
   */
  onRegenerate?: () => void;

  /**
   * Callback function when the message is copied
   */
  onCopy?: (message: string) => void;

  /**
   * Callback function for thumbs up feedback
   */
  onThumbsUp?: (message: Message) => void;

  /**
   * Callback function for thumbs down feedback
   */
  onThumbsDown?: (message: Message) => void;

  /**
   * A list of markdown components to render in assistant message.
   * Useful when you want to render custom elements in the message (e.g a reference tag element)
   */
  markdownTagRenderers?: ComponentsMap;

  /**
   * A custom image rendering component to use instead of the default.
   */
  ImageRenderer?: React.ComponentType<ImageRendererProps>;

  /**
   * @deprecated use message instead
   *
   * The raw data from the assistant's response
   */
  rawData: any;

  /**
   *
   * @deprecated
   *
   * use `message.generativeUI()` instead.
   *
   * For example:
   *
   * ```tsx
   * const CustomAssistantMessage = ({ message }: AssistantMessageProps) => {
   *   const subComponent = message?.generativeUI?.();
   *   return <div>{subComponent}</div>;
   * };
   *
   * ```
   */
  subComponent?: React.JSX.Element;
}

export interface RenderMessageProps {
  message: Message;
  inProgress: boolean;
  index: number;
  isCurrentMessage: boolean;
  actionResult?: string;
  AssistantMessage?: React.ComponentType<AssistantMessageProps>;
  UserMessage?: React.ComponentType<UserMessageProps>;
  ImageRenderer?: React.ComponentType<ImageRendererProps>;

  /**
   * Callback function to regenerate the assistant's response
   */
  onRegenerate?: (messageId: string) => void;

  /**
   * Callback function when the message is copied
   */
  onCopy?: (message: string) => void;

  /**
   * Callback function for thumbs up feedback
   */
  onThumbsUp?: (message: Message) => void;

  /**
   * Callback function for thumbs down feedback
   */
  onThumbsDown?: (message: Message) => void;

  /**
   * A list of markdown components to render in assistant message.
   * Useful when you want to render custom elements in the message (e.g a reference tag element)
   */
  markdownTagRenderers?: ComponentsMap;
}

export interface InputProps {
  inProgress: boolean;
  onSend: (text: string) => Promise<Message>;
  isVisible?: boolean;
  onStop?: () => void;
  onUpload?: () => void;
  hideStopButton?: boolean;
}

export interface RenderSuggestionsListProps {
  suggestions: CopilotChatSuggestion[];
  onSuggestionClick: (message: string) => void;
}

export interface ImageRendererProps {
  /**
   * The image data containing format and bytes
   */
  image: ImageData;

  /**
   * Optional content to display alongside the image
   */
  content?: string;

  /**
   * Additional CSS class name for styling
   */
  className?: string;
}
