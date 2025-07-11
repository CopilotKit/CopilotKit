import agui from "@ag-ui/core";

export interface ImageData {
  format: string;
  bytes: string;
}

// Pass through types
export type Role = agui.Role;
export type ToolResult = agui.ToolMessage;
export type SystemMessage = agui.SystemMessage;
export type DeveloperMessage = agui.DeveloperMessage;
export type ToolCall = agui.ToolCall;

// Extended message types
export type AIMessage = agui.AssistantMessage & {
  render?: (props?: any) => any;
  image?: ImageData;
};

export type UserMessage = agui.UserMessage & {
  image?: ImageData;
};

export type Message = AIMessage | ToolResult | UserMessage | SystemMessage | DeveloperMessage;
