import * as gql from "../client";
import { MessageRole } from "../graphql/@generated/graphql";
import agui from "@copilotkit/shared"; // named agui for clarity, but this only includes agui message types

// Helper function to extract agent name from message
function extractAgentName(message: agui.Message): string {
  if (message.role !== "assistant") {
    throw new Error(`Cannot extract agent name from message with role ${message.role}`);
  }

  return message.agentName || "unknown";
}

// Type guard for agent state message
function isAgentStateMessage(message: agui.Message): boolean {
  return message.role === "assistant" && "agentName" in message && "state" in message;
}

// Type guard for messages with image property
function hasImageProperty(message: agui.Message): boolean {
  const canContainImage = message.role === "assistant" || message.role === "user";
  if (!canContainImage || message.image === undefined) {
    return false;
  }

  const isMalformed = message.image.format === undefined || message.image.bytes === undefined;
  if (isMalformed) {
    return false;
  }

  return true;
}

/*
  ----------------------------
  AGUI Message -> GQL Message
  ----------------------------
*/
export function aguiToGQL(
  messages: agui.Message[] | agui.Message,
  actions?: Record<string, any>,
  coAgentStateRenders?: Record<string, any>,
): gql.Message[] {
  const gqlMessages: gql.Message[] = [];
  messages = Array.isArray(messages) ? messages : [messages];

  // Track tool call names by their IDs for use in result messages
  const toolCallNames: Record<string, string> = {};

  for (const message of messages) {
    // Agent state message support
    if (isAgentStateMessage(message)) {
      const agentName = extractAgentName(message);
      const state = "state" in message && message.state ? message.state : {};
      gqlMessages.push(
        new gql.AgentStateMessage({
          id: message.id,
          agentName,
          state,
          role: gql.Role.Assistant,
        }),
      );
      // Optionally preserve render function
      if ("generativeUI" in message && message.generativeUI && coAgentStateRenders) {
        coAgentStateRenders[agentName] = {
          name: agentName,
          render: message.generativeUI,
        };
      }
      continue;
    }

    if (hasImageProperty(message)) {
      gqlMessages.push(aguiMessageWithImageToGQLMessage(message));
      continue;
    }

    // Action execution message support
    if (message.role === "assistant" && message.toolCalls) {
      gqlMessages.push(aguiTextMessageToGQLMessage(message));
      for (const toolCall of message.toolCalls) {
        // Track the tool call name by its ID
        toolCallNames[toolCall.id] = toolCall.function.name;

        const actionExecMsg = aguiToolCallToGQLActionExecution(toolCall, message.id);
        // Preserve render function in actions context
        if ("generativeUI" in message && message.generativeUI && actions) {
          const actionName = toolCall.function.name;
          // Check for specific action first, then wild card action
          const specificAction = Object.values(actions).find(
            (action: any) => action.name === actionName,
          );
          const wildcardAction = Object.values(actions).find((action: any) => action.name === "*");

          // Assign render function to the matching action (specific takes priority)
          if (specificAction) {
            specificAction.render = message.generativeUI;
          } else if (wildcardAction) {
            wildcardAction.render = message.generativeUI;
          }
        }
        gqlMessages.push(actionExecMsg);
      }
      continue;
    }
    // Regular text messages
    if (
      message.role === "developer" ||
      message.role === "system" ||
      message.role === "assistant" ||
      message.role === "user"
    ) {
      gqlMessages.push(aguiTextMessageToGQLMessage(message));
      continue;
    }
    // Tool result message
    if (message.role === "tool") {
      gqlMessages.push(aguiToolMessageToGQLResultMessage(message, toolCallNames));
      continue;
    }
    throw new Error(
      `Unknown message role: "${(message as any).role}" in message with id: ${(message as any).id}`,
    );
  }

  return gqlMessages;
}

export function aguiTextMessageToGQLMessage(message: agui.Message): gql.TextMessage {
  if (
    message.role !== "developer" &&
    message.role !== "system" &&
    message.role !== "assistant" &&
    message.role !== "user"
  ) {
    throw new Error(`Cannot convert message with role ${message.role} to TextMessage`);
  }

  let roleValue: MessageRole;

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
    role: roleValue,
  });
}

export function aguiToolCallToGQLActionExecution(
  toolCall: agui.ToolCall,
  parentMessageId: string,
): gql.ActionExecutionMessage {
  if (toolCall.type !== "function") {
    throw new Error(`Unsupported tool call type: ${toolCall.type}`);
  }

  // Handle arguments - they should be a JSON string in AGUI format,
  // but we need to convert them to an object for GQL format
  let argumentsObj: any;

  if (typeof toolCall.function.arguments === "string") {
    // Expected case: arguments is a JSON string
    try {
      argumentsObj = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      console.warn(`Failed to parse tool call arguments for ${toolCall.function.name}:`, error);
      // Provide fallback empty object to prevent application crash
      argumentsObj = {};
    }
  } else if (
    typeof toolCall.function.arguments === "object" &&
    toolCall.function.arguments !== null
  ) {
    // Backward compatibility: arguments is already an object
    argumentsObj = toolCall.function.arguments;
  } else {
    // Fallback for undefined, null, or other types
    console.warn(
      `Invalid tool call arguments type for ${toolCall.function.name}:`,
      typeof toolCall.function.arguments,
    );
    argumentsObj = {};
  }

  // Always include name and arguments
  return new gql.ActionExecutionMessage({
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: argumentsObj,
    parentMessageId: parentMessageId,
  });
}

export function aguiToolMessageToGQLResultMessage(
  message: agui.Message,
  toolCallNames: Record<string, string>,
): gql.ResultMessage {
  if (message.role !== "tool") {
    throw new Error(`Cannot convert message with role ${message.role} to ResultMessage`);
  }

  if (!message.toolCallId) {
    throw new Error("Tool message must have a toolCallId");
  }

  const actionName = toolCallNames[message.toolCallId] || "unknown";

  // Handle result content - it could be a string or an object that needs serialization
  let resultContent: string;
  const messageContent = message.content || "";

  if (typeof messageContent === "string") {
    // Expected case: content is already a string
    resultContent = messageContent;
  } else if (typeof messageContent === "object" && messageContent !== null) {
    // Handle case where content is an object that needs to be serialized
    try {
      resultContent = JSON.stringify(messageContent);
    } catch (error) {
      console.warn(`Failed to stringify tool result for ${actionName}:`, error);
      resultContent = String(messageContent);
    }
  } else {
    // Handle other types (number, boolean, etc.)
    resultContent = String(messageContent);
  }

  return new gql.ResultMessage({
    id: message.id,
    result: resultContent,
    actionExecutionId: message.toolCallId,
    actionName: message.toolName || actionName,
  });
}

// New function to handle AGUI messages with render functions
export function aguiMessageWithRenderToGQL(
  message: agui.Message,
  actions?: Record<string, any>,
  coAgentStateRenders?: Record<string, any>,
): gql.Message[] {
  // Handle the special case: assistant messages with render function but no tool calls
  if (
    message.role === "assistant" &&
    "generativeUI" in message &&
    message.generativeUI &&
    !message.toolCalls
  ) {
    const gqlMessages: gql.Message[] = [];
    gqlMessages.push(
      new gql.AgentStateMessage({
        id: message.id,
        agentName: "unknown",
        state: {},
        role: gql.Role.Assistant,
      }),
    );
    if (coAgentStateRenders) {
      coAgentStateRenders.unknown = {
        name: "unknown",
        render: message.generativeUI,
      };
    }
    return gqlMessages;
  }

  // For all other cases, delegate to aguiToGQL
  return aguiToGQL([message], actions, coAgentStateRenders);
}

export function aguiMessageWithImageToGQLMessage(message: agui.Message): gql.ImageMessage {
  if (!hasImageProperty(message)) {
    throw new Error(`Cannot convert message to ImageMessage: missing format or bytes`);
  }

  let roleValue: MessageRole;
  if (message.role === "assistant") {
    roleValue = gql.Role.Assistant;
  } else {
    roleValue = gql.Role.User;
  }

  if (message.role !== "assistant" && message.role !== "user") {
    throw new Error(`Cannot convert message with role ${message.role} to ImageMessage`);
  }

  return new gql.ImageMessage({
    id: message.id,
    format: message.image!.format,
    bytes: message.image!.bytes,
    role: roleValue,
  });
}
