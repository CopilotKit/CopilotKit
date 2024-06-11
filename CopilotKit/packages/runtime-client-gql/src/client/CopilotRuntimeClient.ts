import { Client, cacheExchange, fetchExchange } from "@urql/core";

import {
  GenerateResponseMutation,
  GenerateResponseMutationVariables,
  MessageInput,
} from "../graphql/@generated/graphql";
import { generateResponseMutation } from "../graphql/mutations";
import { OperationResultSource, OperationResult } from "urql";
import { ActionExecutionMessage, IMessage, ResultMessage, TextMessage } from "@copilotkit/shared";
import untruncateJson from "untruncate-json";

interface CopilotRuntimeClientOptions {
  url: string;
}

export class CopilotRuntimeClient {
  client: Client;

  constructor(options: CopilotRuntimeClientOptions) {
    this.client = new Client({
      url: options.url,
      exchanges: [cacheExchange, fetchExchange],
    });
  }
  generateResponse(data: GenerateResponseMutationVariables["data"]) {
    return this.client.mutation<GenerateResponseMutation, GenerateResponseMutationVariables>(
      generateResponseMutation,
      { data },
    );
  }

  static asStream<S, T>(source: OperationResultSource<OperationResult<S, { data: T }>>) {
    return new ReadableStream<S>({
      start(controller) {
        source.subscribe(({ data, hasNext }) => {
          controller.enqueue(data);
          if (!hasNext) {
            controller.close();
          }
        });
      },
    });
  }

  static convertMessagesToGqlInput(messages: IMessage[]): MessageInput[] {
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

  static convertGqlOutputToMessages(
    messages: GenerateResponseMutation["generateResponse"]["messages"],
  ): IMessage[] {
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
          arguments: CopilotRuntimeClient.getPartialArguments(message.arguments),
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

  private static getPartialArguments(args: string[]) {
    try {
      return JSON.parse(untruncateJson(args.join("")));
    } catch (e) {
      return {};
    }
  }
}
