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
  RenderTextMessage: React.ComponentType<RenderMessageProps>;
  RenderActionExecutionMessage: React.ComponentType<RenderMessageProps>;
  RenderAgentStateMessage: React.ComponentType<RenderMessageProps>;
  RenderResultMessage: React.ComponentType<RenderMessageProps>;
}

export interface RenderMessageProps {
  message: Message;
  inProgress: boolean;
  index: number;
  isCurrentMessage: boolean;
  actionResult?: string;
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
