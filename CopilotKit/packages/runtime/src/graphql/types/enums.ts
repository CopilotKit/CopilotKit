import { registerEnumType } from "type-graphql";

export enum MessageRole {
  user = "user",
  assistant = "assistant",
  system = "system",
}

export enum ActionExecutionScope {
  server = "server",
  client = "client",
}

registerEnumType(MessageRole, {
  name: "MessageRole",
  description: "The role of the message",
});

registerEnumType(ActionExecutionScope, {
  name: "ActionExecutionScope",
  description: "The scope of the action",
});
