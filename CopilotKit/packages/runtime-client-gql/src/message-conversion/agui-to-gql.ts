import * as gql from "../client";
import agui from "@copilotkit/shared"; // named agui for clarity, but this only includes agui message types

/*
  ----------------------------
  AGUI Message -> GQL Message
  ----------------------------
*/
export function aguiToGQL(messages: agui.Message[] | agui.Message): gql.Message[] {
  const gqlMessages: gql.Message[] = [];
  messages = Array.isArray(messages) ? messages : [messages];
  
  for (const message of messages) {
    if (message.role === "developer" || message.role === "system" || message.role === "assistant" || message.role === "user") {
      gqlMessages.push(aguiTextMessageToGQLMessage(message));
      
      // Process tool calls if this is an assistant message with tool calls
      if (message.role === "assistant" && message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          gqlMessages.push(aguiToolCallToGQLActionExecution(toolCall, message.id));
        }
      }
    } else if (message.role === "tool") {
      gqlMessages.push(aguiToolMessageToGQLResultMessage(message));
    } else {
      throw new Error(`Unknown message role in message: ${message}`);
    }
  }
  
  return gqlMessages;
}

export function aguiTextMessageToGQLMessage(message: agui.Message): gql.TextMessage {
  if (message.role !== "developer" && message.role !== "system" && message.role !== "assistant" && message.role !== "user") {
    throw new Error(`Cannot convert message with role ${message.role} to TextMessage`);
  }

  let roleValue: string;
  
  if (message.role === "developer") {
    roleValue = gql.Role.Developer;
  } else if (message.role === "system") {
    roleValue = gql.Role.System;
  } else if (message.role === "assistant") {
    roleValue = gql.Role.Assistant;
  } else {
    roleValue = gql.Role.User;
  }

  return new gql.TextMessage({
    id: message.id,
    content: message.content || "",
    role: roleValue as any
  });
}

export function aguiToolCallToGQLActionExecution(toolCall: agui.ToolCall, parentMessageId: string): gql.ActionExecutionMessage {
  if (toolCall.type !== "function") {
    throw new Error(`Unsupported tool call type: ${toolCall.type}`);
  }

  return new gql.ActionExecutionMessage({
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: JSON.parse(toolCall.function.arguments),
    parentMessageId: parentMessageId
  });
}

export function aguiToolMessageToGQLResultMessage(message: agui.Message): gql.ResultMessage {
  if (message.role !== "tool") {
    throw new Error(`Cannot convert message with role ${message.role} to ResultMessage`);
  }

  if (!message.toolCallId) {
    throw new Error("Tool message must have a toolCallId");
  }

  return new gql.ResultMessage({
    id: message.id,
    result: message.content || "",
    actionExecutionId: message.toolCallId,
    actionName: "" // Not required in the original conversion
  });
}
