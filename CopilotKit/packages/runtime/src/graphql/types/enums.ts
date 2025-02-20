import { registerEnumType } from "type-graphql";

export enum MessageRole {
  user = "user",
  assistant = "assistant",
  system = "system",
  tool = "tool",
  developer = "developer",
}

export enum CopilotRequestType {
  Chat = "Chat",
  Task = "Task",
  TextareaCompletion = "TextareaCompletion",
  TextareaPopover = "TextareaPopover",
  Suggestion = "Suggestion",
}

export enum ActionInputAvailability {
  disabled = "disabled",
  enabled = "enabled",
  remote = "remote",
}

registerEnumType(MessageRole, {
  name: "MessageRole",
  description: "The role of the message",
});

registerEnumType(CopilotRequestType, {
  name: "CopilotRequestType",
  description: "The type of Copilot request",
});

registerEnumType(ActionInputAvailability, {
  name: "ActionInputAvailability",
  description: "The availability of the frontend action",
});
