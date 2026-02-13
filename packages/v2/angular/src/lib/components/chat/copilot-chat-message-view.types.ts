import { Message } from "@ag-ui/client";
import { Type, TemplateRef } from "@angular/core";

// Context interfaces for template slots
export interface MessageViewContext {
  showCursor: boolean;
  messages: Message[];
  messageElements: any[]; // Will be populated with rendered elements
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CursorContext {
  // Empty for now, can be extended if needed
}

// Component input props interface
export interface CopilotChatMessageViewProps {
  messages?: Message[];
  showCursor?: boolean;
  inputClass?: string;

  // Assistant message slots
  assistantMessageComponent?: Type<any>;
  assistantMessageTemplate?: TemplateRef<any>;
  assistantMessageClass?: string;

  // User message slots
  userMessageComponent?: Type<any>;
  userMessageTemplate?: TemplateRef<any>;
  userMessageClass?: string;

  // Cursor slots
  cursorComponent?: Type<any>;
  cursorTemplate?: TemplateRef<any>;
  cursorClass?: string;
}

// Re-export for convenience
export type { Message };
