import agui from "@ag-ui/core"

export type Role = agui.Role;

export type ToolResult = agui.ToolMessage;
export type UserMessage = agui.UserMessage;
export type SystemMessage = agui.SystemMessage;
export type DeveloperMessage = agui.DeveloperMessage;
export type ToolCall = agui.ToolCall;
export type AIMessage = agui.AssistantMessage & {
  render?: (props?: any) => any;
  renderAndWaitForResponse?: (props?: any) => any;
}

export type Message = AIMessage | ToolResult | UserMessage | SystemMessage | DeveloperMessage;