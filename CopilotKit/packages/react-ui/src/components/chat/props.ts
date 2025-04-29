import { Message } from "@copilotkit/runtime-client-gql";
import { Components } from "react-markdown";

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

export interface MessagesProps {
  messages: Message[];
  inProgress: boolean;
  children?: React.ReactNode;
  AssistantMessage: React.ComponentType<AssistantMessageProps>;
  UserMessage: React.ComponentType<UserMessageProps>;
  RenderTextMessage: React.ComponentType<RenderMessageProps>;
  RenderActionExecutionMessage: React.ComponentType<RenderMessageProps>;
  RenderAgentStateMessage: React.ComponentType<RenderMessageProps>;
  RenderResultMessage: React.ComponentType<RenderMessageProps>;
  RenderImageMessage: React.ComponentType<RenderMessageProps>;

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
  onThumbsUp?: (message: string) => void;

  /**
   * Callback function for thumbs down feedback
   */
  onThumbsDown?: (message: string) => void;

  /**
   * A list of markdown components to render in assistant message.
   * Useful when you want to render custom elements in the message (e.g a reference tag element)
   */
  markdownTagRenderers?: Components;
}

export interface Renderer {
  content: string;
}

export interface UserMessageProps {
  message?: string;
  rawData: any;
  subComponent?: React.JSX.Element;
}

export interface AssistantMessageProps {
  /**
   * The message content from the assistant
   */

  message?: string;

  /**
   * Indicates if this is the last message
   */
  isCurrentMessage?: boolean;

  /**
   * The raw data from the assistant's response
   */
  rawData: any;

  /**
   * A component that was decided to render by the LLM.
   * When working with useCopilotActions and useCoAgentStateRender, this will be
   * the render component that was specified.
   */
  subComponent?: React.JSX.Element;

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
  onThumbsUp?: (message: string) => void;

  /**
   * Callback function for thumbs down feedback
   */
  onThumbsDown?: (message: string) => void;

  /**
   * A list of markdown components to render in assistant message.
   * Useful when you want to render custom elements in the message (e.g a reference tag element)
   */
  markdownTagRenderers?: Components;
}

export interface RenderMessageProps {
  message: Message;
  inProgress: boolean;
  index: number;
  isCurrentMessage: boolean;
  actionResult?: string;
  AssistantMessage?: React.ComponentType<AssistantMessageProps>;
  UserMessage?: React.ComponentType<UserMessageProps>;

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
  onThumbsUp?: (message: string) => void;

  /**
   * Callback function for thumbs down feedback
   */
  onThumbsDown?: (message: string) => void;

  /**
   * A list of markdown components to render in assistant message.
   * Useful when you want to render custom elements in the message (e.g a reference tag element)
   */
  markdownTagRenderers?: Components;
}

export interface InputProps {
  inProgress: boolean;
  onSend: (text: string) => Promise<Message>;
  isVisible?: boolean;
  onStop?: () => void;
  onUpload?: () => void;
}
