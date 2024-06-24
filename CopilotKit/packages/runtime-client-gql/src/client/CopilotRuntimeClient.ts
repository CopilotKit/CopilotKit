import { Client, cacheExchange, fetchExchange } from "@urql/core";

import {
  RunCopilotChatMutation,
  RunCopilotChatMutationVariables,
} from "../graphql/@generated/graphql";
import { runCopilotChatMutation } from "../graphql/definitions/mutations";
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

  runCopilotChat(
    data: RunCopilotChatMutationVariables["data"],
    properties?: RunCopilotChatMutationVariables["properties"],
  ) {
    return this.client.mutation<RunCopilotChatMutation, RunCopilotChatMutationVariables>(
      runCopilotChatMutation,
      { data, properties },
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
