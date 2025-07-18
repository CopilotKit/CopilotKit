import agui from "@ag-ui/core";

export interface ImageData {
  format: string;
  bytes: string;
}

// Pass through types
export type Role = agui.Role;
export type SystemMessage = agui.SystemMessage;
export type DeveloperMessage = agui.DeveloperMessage;
export type ToolCall = agui.ToolCall;

// Extended message types
export type ToolResult = agui.ToolMessage & {
  toolName?: string;
};

export type AIMessage = agui.AssistantMessage & {
  generativeUI?: (props?: any) => any;
  agentName?: string;
  state?: any;
  image?: ImageData;
};

export type UserMessage = agui.UserMessage & {
  image?: ImageData;
};

export type Message = AIMessage | ToolResult | UserMessage | SystemMessage | DeveloperMessage;
