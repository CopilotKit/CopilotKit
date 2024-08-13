import { registerEnumType } from "type-graphql";

export enum MessageRole {
  user = "user",
  assistant = "assistant",
  system = "system",
}

export enum ActionExecutionScope {
  server = "server",
  client = "client",
  passThrough = "passThrough",
}

export enum CopilotRequestType {
  Chat = "Chat",
  Task = "Task",
  TextareaCompletion = "TextareaCompletion",
  TextareaPopover = "TextareaPopover",
  Suggestion = "Suggestion",
}

registerEnumType(MessageRole, {
  name: "MessageRole",
  description: "The role of the message",
});

registerEnumType(ActionExecutionScope, {
  name: "ActionExecutionScope",
  description: "The scope of the action",
});

registerEnumType(CopilotRequestType, {
  name: "CopilotRequestType",
  description: "The type of Copilot request",
});
