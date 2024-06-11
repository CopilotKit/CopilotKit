import { GenerateResponseMutation, MessageInput } from "../graphql/@generated/graphql";
import { ActionExecutionMessage, Message, ResultMessage, TextMessage } from "@copilotkit/shared";
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
        },
      };
    } else {
      throw new Error("Unknown message type");
    }
  });
}

export function convertGqlOutputToMessages(
  messages: GenerateResponseMutation["generateResponse"]["messages"],
): Message[] {
  return messages.map((message) => {
    if (message.__typename === "TextMessageOutput") {
      return new TextMessage({
        id: message.id,
        role: message.role as any,
        content: message.content.join(""),
        createdAt: new Date(),
        isDoneStreaming: message.status?.isDoneStreaming || false,
      });
    } else if (message.__typename === "ActionExecutionMessageOutput") {
      return new ActionExecutionMessage({
        id: message.id,
        name: message.name,
        arguments: getPartialArguments(message.arguments),
        scope: message.scope as any,
        createdAt: new Date(),
        isDoneStreaming: message.status?.isDoneStreaming || false,
      });
    } else if (message.__typename === "ResultMessageOutput") {
      return new ResultMessage({
        id: message.id,
        result: message.result,
        actionExecutionId: message.actionExecutionId,
        createdAt: new Date(),
        isDoneStreaming: true,
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
