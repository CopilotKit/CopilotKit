/* eslint-disable @typescript-eslint/no-empty-object-type */
import { AssistantMessage } from "@ag-ui/client";

// Context interfaces for slots
export interface AssistantMessageMarkdownRendererContext {
  content: string;
}

export interface AssistantMessageToolbarContext {
  children?: any;
}

export interface AssistantMessageCopyButtonContext {
  content?: string;
}

export interface ThumbsUpButtonContext {
  // Empty context - click handled via outputs map
}

export interface ThumbsDownButtonContext {
  // Empty context - click handled via outputs map
}

export interface ReadAloudButtonContext {
  // Empty context - click handled via outputs map
}

export interface RegenerateButtonContext {
  // Empty context - click handled via outputs map
}

// Event handler props
export interface CopilotChatAssistantMessageOnThumbsUpProps {
  message: AssistantMessage;
}

export interface CopilotChatAssistantMessageOnThumbsDownProps {
  message: AssistantMessage;
}

export interface CopilotChatAssistantMessageOnReadAloudProps {
  message: AssistantMessage;
}

export interface CopilotChatAssistantMessageOnRegenerateProps {
  message: AssistantMessage;
}

// Re-export for convenience
export type { AssistantMessage };
