import { Message } from "@copilotkit/runtime-client-gql";

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
}

export interface Renderer {
  content: string;
}

export interface UserMessageProps {
  message?: string;
  rawData: any;
}

export interface AssistantMessageProps {
  /**
   * The message content from the assistant
   */

  message?: string;

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
}

export interface RenderMessageProps {
  message: Message;
  inProgress: boolean;
  index: number;
  isCurrentMessage: boolean;
  actionResult?: string;
  AssistantMessage: React.ComponentType<AssistantMessageProps>;
  UserMessage: React.ComponentType<UserMessageProps>;
}

export interface InputProps {
  inProgress: boolean;
  onSend: (text: string) => Promise<Message>;
  isVisible?: boolean;
}

export interface ResponseButtonProps {
  onClick: () => void;
  inProgress: boolean;
}
