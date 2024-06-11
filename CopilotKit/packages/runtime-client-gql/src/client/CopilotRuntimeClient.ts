import { Client, cacheExchange, fetchExchange } from "@urql/core";

import {
  GenerateResponseMutation,
  GenerateResponseMutationVariables,
  MessageInput,
} from "../graphql/@generated/graphql";
import { generateResponseMutation } from "../graphql/mutations";
import { OperationResultSource, OperationResult } from "urql";
import { ActionExecutionMessage, IMessage, ResultMessage, TextMessage } from "@copilotkit/shared";
import { convertGqlOutputToMessages, convertMessagesToGqlInput } from "./conversion";

interface CopilotRuntimeClientOptions {
  url: string;
}

type CustomGenerateResponseData = Omit<GenerateResponseMutationVariables["data"], "messages"> & {
  messages: IMessage[];
};

type CustomGenerateResponseMutation = Omit<
  GenerateResponseMutation["generateResponse"],
  "messages"
> & {
  messages: IMessage[];
};

export class CopilotRuntimeClient {
  client: Client;

  constructor(options: CopilotRuntimeClientOptions) {
    this.client = new Client({
      url: options.url,
      exchanges: [cacheExchange, fetchExchange],
    });
  }
  generateResponse(data: GenerateResponseMutationVariables["data"]) {
    const result = this.client.mutation<
      GenerateResponseMutation,
      GenerateResponseMutationVariables
    >(generateResponseMutation, { data });
    return result;
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

  // TODO-PROTOCOL: use wonka pipe & map to implement this
  generateResponseAsStream(data: CustomGenerateResponseData) {
    const source = this.client.mutation<
      GenerateResponseMutation,
      GenerateResponseMutationVariables
    >(generateResponseMutation, {
      data: { ...data, messages: convertMessagesToGqlInput(data.messages) },
    });

    return new ReadableStream<GenerateResponseMutation>({
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
}
