import { Client, cacheExchange, fetchExchange } from "@urql/core";

import {
  CreateChatCompletionMutation,
  CreateChatCompletionMutationVariables,
} from "../graphql/@generated/graphql";
import { createChatCompletionMutation } from "../graphql/mutations";
import { OperationResultSource, OperationResult } from "urql";

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

  createChatCompletion(data: CreateChatCompletionMutationVariables["data"]) {
    return this.client.mutation<CreateChatCompletionMutation, CreateChatCompletionMutationVariables>(
      createChatCompletionMutation,
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
}
