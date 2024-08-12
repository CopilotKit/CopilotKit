import { threadId } from "node:worker_threads";
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
} from "./types";

import untruncateJson from "untruncate-json";

export function convertMessagesToGqlInput(messages: Message[]): MessageInput[] {
  return messages.map((message) => {
    if (message instanceof TextMessage) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        textMessage: {
          content: message.content,
          role: message.role as any,
        },
      };
    } else if (message instanceof ActionExecutionMessage) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        actionExecutionMessage: {
          name: message.name,
          arguments: JSON.stringify(message.arguments),
          scope: message.scope as any,
        },
      };
    } else if (message instanceof ResultMessage) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        resultMessage: {
          result: message.result,
          actionExecutionId: message.actionExecutionId,
          actionName: message.actionName,
        },
      };
    } else if (message instanceof AgentStateMessage) {
      return {
        id: message.id,
        createdAt: message.createdAt,
        agentStateMessage: {
          threadId: message.threadId,
          role: message.role,
          agentName: message.agentName,
          nodeName: message.nodeName,
          running: message.running,
          state: JSON.stringify(message.state),
        },
      };
    } else {
      throw new Error("Unknown message type");
    }
  });
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
        createdAt: new Date(),
        status: message.status || { code: MessageStatusCode.Pending },
      });
    } else if (message.__typename === "ActionExecutionMessageOutput") {
      return new ActionExecutionMessage({
        id: message.id,
        name: message.name,
        arguments: getPartialArguments(message.arguments),
        scope: message.scope,
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
        running: message.running,
        state: JSON.parse(message.state),
        createdAt: new Date(),
      });
    }

    throw new Error("Unknown message type");
  });
}

function getPartialArguments(args: string[]) {
  try {
    return JSON.parse(untruncateJson(args.join("")));
  } catch (e) {
    return {};
  }
}
