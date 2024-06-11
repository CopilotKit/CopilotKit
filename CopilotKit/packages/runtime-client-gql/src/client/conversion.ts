import { ActionExecutionMessage, IMessage, ResultMessage, TextMessage } from "@copilotkit/shared";
import { MessageInput, GenerateResponseMutation } from "../graphql/@generated/graphql";
import untruncateJson from "untruncate-json";

export function convertMessagesToGqlInput(messages: IMessage[]): MessageInput[] {
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
): IMessage[] {
  return messages.map((message) => {
    if (message.__typename === "TextMessageOutput") {
      return new TextMessage({
        id: message.id,
        role: message.role as any,
        content: message.content.join(""),
        createdAt: new Date(),
        isStreaming: message.status.isDoneStreaming || false,
      });
    } else if (message.__typename === "ActionExecutionMessageOutput") {
      return new ActionExecutionMessage({
        id: message.id,
        name: message.name,
        arguments: getPartialArguments(message.arguments),
        scope: message.scope as any,
        createdAt: new Date(),
        isStreaming: message.status.isDoneStreaming || false,
      });
    } else if (message.__typename === "ResultMessageOutput") {
      return new ResultMessage({
        id: message.id,
        result: message.result,
        actionExecutionId: message.actionExecutionId,
        createdAt: new Date(),
        isStreaming: false,
      });
    }

    throw new Error("Unknown message type");
  });
}

const getPartialArguments = (args: string[]) => {
  try {
    return JSON.parse(untruncateJson(args.join("")));
  } catch (e) {
    return {};
  }
};
