import { AIMessage, Message, UserMessage } from "@copilotkit/shared";
import { CopilotChatSuggestion } from "../../types/suggestions";
import { ReactNode } from "react";
import { ImageData } from "@copilotkit/shared";

export interface ButtonProps { }

export interface WindowProps {
  clickOutsideToClose: boolean;
  hitEscapeToClose: boolean;
  shortcut: string;
  children?: React.ReactNode;
}

export interface HeaderProps { }

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
  canRegenerateAssistantMessage?: AssistantMessageProps["canRegenerate"];
  canCopyAssistantMessage?: AssistantMessageProps["canCopy"];
  disableFirstAssistantMessageControls?: AssistantMessageProps["disableFirstMessageControls"];
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
}

export interface Renderer {
  content: string;
}

export interface UserMessageProps {
  message?: UserMessage;
  ImageRenderer: React.ComponentType<ImageRendererProps>;
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
   * Whether the assistant's response can be regenerated.
   */
  canRegenerate?: boolean;

  /**
   * Whether the message can be copied.
   */
  canCopy?: boolean;

  /**
   * Whether the first assistant message has its controls disabled.
   * The controls are the buttons for thumbs up, thumbs down, copy, and regenerate.
   */
  disableFirstMessageControls?: boolean;

  index?: number;

  /**
   * A custom image rendering component to use instead of the default.
   */
  ImageRenderer?: React.ComponentType<ImageRendererProps>;
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

  /**
   * Whether the assistant's response can be regenerated.
   */
  canRegenerateAssistantMessage?: AssistantMessageProps["canRegenerate"];

  /**
   * Whether the message can be copied.
   */
  canCopyAssistantMessage?: AssistantMessageProps["canCopy"];

  /**
   * Whether the first assistant message has its controls disabled.
   * The controls are the buttons for thumbs up, thumbs down, copy, and regenerate.
   */
  disableFirstAssistantMessageControls?: AssistantMessageProps["disableFirstMessageControls"];
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
