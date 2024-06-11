import { Client, cacheExchange, fetchExchange } from "@urql/core";

import {
  GenerateResponseMutation,
  GenerateResponseMutationVariables,
} from "../graphql/@generated/graphql";
import { generateResponseMutation } from "../graphql/mutations";
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
}
