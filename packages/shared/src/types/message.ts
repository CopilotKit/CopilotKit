import * as agui from "@ag-ui/core";

// Re-export AG-UI multimodal input types.
// Note: AG-UI names the text variant TextInputContent; we export it as TextInputPart for consistency.
export type {
  InputContent,
  InputContentSource,
  InputContentDataSource,
  InputContentUrlSource,
  TextInputContent as TextInputPart,
  ImageInputPart,
  AudioInputPart,
  VideoInputPart,
  DocumentInputPart,
} from "@ag-ui/core";

/**
 * @deprecated Use `InputContentSource` from `@ag-ui/core` (re-exported from `@copilotkit/shared`) instead.
 * `ImageData` only described base64 image payloads. `InputContentSource` supports
 * data and URL sources for images, audio, video, and documents.
 * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
 * @since 1.56.0
 */
export interface ImageData {
  format: string;
  bytes: string;
}

// Pass through types
export type Role = agui.Role;
export type SystemMessage = agui.SystemMessage;
export type DeveloperMessage = agui.DeveloperMessage;
export type ToolCall = agui.ToolCall;
export type ActivityMessage = agui.ActivityMessage;
export type ReasoningMessage = agui.ReasoningMessage;

// Extended message types
export type ToolResult = agui.ToolMessage & {
  toolName?: string;
};

export type AIMessage = agui.AssistantMessage & {
  generativeUI?: (props?: any) => any;
  generativeUIPosition?: "before" | "after";
  agentName?: string;
  state?: any;
  /**
   * @deprecated Use multimodal `content` array with `InputContent` parts instead.
   * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
   * @since 1.56.0
   */
  image?: ImageData;
  runId?: string;
};

export type UserMessage = agui.UserMessage;

export type Message =
  | AIMessage
  | ToolResult
  | UserMessage
  | SystemMessage
  | DeveloperMessage
  | ActivityMessage
  | ReasoningMessage;
