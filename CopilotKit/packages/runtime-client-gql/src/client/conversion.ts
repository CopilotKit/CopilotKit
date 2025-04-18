import {
  GenerateCopilotResponseMutation,
  MessageInput,
  MessageStatusCode,
} from "../graphql/@generated/graphql";
import {
  ActionExecutionMessage,
  AgentStateMessage,
  Message,
  ResultMessage,
  TextMessage,
  ImageMessage,
} from "./types";

import untruncateJson from "untruncate-json";
import { parseJson } from "@copilotkit/shared";

export function filterAgentStateMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !message.isAgentStateMessage());
}

export function convertMessagesToGqlInput(messages: Message[]): MessageInput[] {
  return messages.map((message) => {
    if (message.isTextMessage()) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        textMessage: {
          content: message.content,
          role: message.role as any,
          parentMessageId: message.parentMessageId,
        },
      };
    } else if (message.isActionExecutionMessage()) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        actionExecutionMessage: {
          name: message.name,
          arguments: JSON.stringify(message.arguments),
          parentMessageId: message.parentMessageId,
        },
      };
    } else if (message.isResultMessage()) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        resultMessage: {
          result: message.result,
          actionExecutionId: message.actionExecutionId,
          actionName: message.actionName,
        },
      };
    } else if (message.isAgentStateMessage()) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        agentStateMessage: {
          threadId: message.threadId,
          role: message.role,
          agentName: message.agentName,
          nodeName: message.nodeName,
          runId: message.runId,
          active: message.active,
          running: message.running,
          state: JSON.stringify(message.state),
        },
      };
    } else if (message.isImageMessage()) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        imageMessage: {
          format: message.format,
          bytes: message.bytes,
          role: message.role as any,
          parentMessageId: message.parentMessageId,
        },
      };
    } else {
      throw new Error("Unknown message type");
    }
  });
}

export function filterAdjacentAgentStateMessages(
  messages: GenerateCopilotResponseMutation["generateCopilotResponse"]["messages"],
): GenerateCopilotResponseMutation["generateCopilotResponse"]["messages"] {
  const filteredMessages: GenerateCopilotResponseMutation["generateCopilotResponse"]["messages"] =
    [];

  messages.forEach((message, i) => {
    // keep all other message types
    if (message.__typename !== "AgentStateMessageOutput") {
      filteredMessages.push(message);
    } else {
      const prevAgentStateMessageIndex = filteredMessages.findIndex(
        // TODO: also check runId
        (m) => m.__typename === "AgentStateMessageOutput" && m.agentName === message.agentName,
      );
      if (prevAgentStateMessageIndex === -1) {
        filteredMessages.push(message);
      } else {
        filteredMessages[prevAgentStateMessageIndex] = message;
      }
    }
  });

  return filteredMessages;
}

export function convertGqlOutputToMessages(
  messages: GenerateCopilotResponseMutation["generateCopilotResponse"]["messages"],
): Message[] {
  return messages.map((message) => {
    if (message.__typename === "TextMessageOutput") {
      return new TextMessage({
        id: message.id,
        role: message.role,
        content: message.content.join(""),
        parentMessageId: message.parentMessageId,
        createdAt: new Date(),
        status: message.status || { code: MessageStatusCode.Pending },
      });
    } else if (message.__typename === "ActionExecutionMessageOutput") {
      return new ActionExecutionMessage({
        id: message.id,
        name: message.name,
        arguments: getPartialArguments(message.arguments),
        parentMessageId: message.parentMessageId,
        createdAt: new Date(),
        status: message.status || { code: MessageStatusCode.Pending },
      });
    } else if (message.__typename === "ResultMessageOutput") {
      return new ResultMessage({
        id: message.id,
        result: message.result,
        actionExecutionId: message.actionExecutionId,
        actionName: message.actionName,
        createdAt: new Date(),
        status: message.status || { code: MessageStatusCode.Pending },
      });
    } else if (message.__typename === "AgentStateMessageOutput") {
      return new AgentStateMessage({
        id: message.id,
        threadId: message.threadId,
        role: message.role,
        agentName: message.agentName,
        nodeName: message.nodeName,
        runId: message.runId,
        active: message.active,
        running: message.running,
        state: parseJson(message.state, {}),
        createdAt: new Date(),
      });
    } else if (message.__typename === "ImageMessageOutput") {
      return new ImageMessage({
        id: message.id,
        format: message.format,
        bytes: message.bytes,
        role: message.role,
        parentMessageId: message.parentMessageId,
        createdAt: new Date(),
        status: message.status || { code: MessageStatusCode.Pending },
      });
    }

    throw new Error("Unknown message type");
  });
}

export function loadMessagesFromJsonRepresentation(json: any[]): Message[] {
  const result: Message[] = [];
  for (const item of json) {
    if ("content" in item) {
      result.push(
        new TextMessage({
          id: item.id,
          role: item.role,
          content: item.content,
          parentMessageId: item.parentMessageId,
          createdAt: item.createdAt || new Date(),
          status: item.status || { code: MessageStatusCode.Success },
        }),
      );
    } else if ("arguments" in item) {
      result.push(
        new ActionExecutionMessage({
          id: item.id,
          name: item.name,
          arguments: item.arguments,
          parentMessageId: item.parentMessageId,
          createdAt: item.createdAt || new Date(),
          status: item.status || { code: MessageStatusCode.Success },
        }),
      );
    } else if ("result" in item) {
      result.push(
        new ResultMessage({
          id: item.id,
          result: item.result,
          actionExecutionId: item.actionExecutionId,
          actionName: item.actionName,
          createdAt: item.createdAt || new Date(),
          status: item.status || { code: MessageStatusCode.Success },
        }),
      );
    } else if ("state" in item) {
      result.push(
        new AgentStateMessage({
          id: item.id,
          threadId: item.threadId,
          role: item.role,
          agentName: item.agentName,
          nodeName: item.nodeName,
          runId: item.runId,
          active: item.active,
          running: item.running,
          state: item.state,
          createdAt: item.createdAt || new Date(),
        }),
      );
    } else if ("format" in item && "bytes" in item) {
      result.push(
        new ImageMessage({
          id: item.id,
          format: item.format,
          bytes: item.bytes,
          role: item.role,
          parentMessageId: item.parentMessageId,
          createdAt: item.createdAt || new Date(),
          status: item.status || { code: MessageStatusCode.Success },
        }),
      );
    }
  }
  return result;
}

function getPartialArguments(args: string[]) {
  try {
    if (!args.length) return {};

    return JSON.parse(untruncateJson(args.join("")));
  } catch (e) {
    return {};
  }
}
