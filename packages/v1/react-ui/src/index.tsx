"use client";
import "./styles.css";

export type {
  CopilotObservabilityHooks,
  ButtonProps,
  WindowProps,
  HeaderProps,
  SuggestionsProps,
  ComponentsMap,
  MessagesProps,
  Renderer,
  UserMessageProps,
  AssistantMessageProps,
  ErrorMessageProps,
  RenderMessageProps,
  InputProps,
  RenderSuggestionsListProps,
  ImageRendererProps,
  ChatError,
} from "./components";
export {
  CopilotPopup,
  CopilotSidebar,
  CopilotChat,
  Markdown,
  AssistantMessage,
  UserMessage,
  ImageRenderer,
  useChatContext,
  RenderSuggestionsList,
  RenderSuggestion,
  shouldShowDevConsole,
  CopilotDevConsole,
} from "./components";

export { useCopilotChatSuggestions } from "./hooks";

export type { CopilotKitCSSProperties } from "./types";
export type { CopilotChatSuggestion } from "./types";
