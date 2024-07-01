import { Client, cacheExchange, fetchExchange } from "@urql/core";

import {
  GenerateCopilotResponseMutation,
  GenerateCopilotResponseMutationVariables,
} from "../graphql/@generated/graphql";
import { generateCopilotResponseMutation } from "../graphql/definitions/mutations";
import { OperationResultSource, OperationResult } from "urql";

interface CopilotRuntimeClientOptions {
  url: string;
  publicApiKey?: string;
  headers?: Record<string, string>;
}

export class CopilotRuntimeClient {
  client: Client;

  constructor(options: CopilotRuntimeClientOptions) {
    const headers: Record<string, string> = {};

    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    if (options.publicApiKey) {
      headers["x-copilotcloud-public-api-key"] = options.publicApiKey;
    }

    this.client = new Client({
      url: options.url,
      exchanges: [cacheExchange, fetchExchange],
      fetchOptions: {
        headers,
      },
    });
  }

  generateCopilotResponse(
    data: GenerateCopilotResponseMutationVariables["data"],
    properties?: GenerateCopilotResponseMutationVariables["properties"],
    signal?: AbortSignal,
  ) {
    function fetchWithAbortSignal(url: RequestInfo, opts: RequestInit): Promise<Response> {
      return fetch(url, {
        ...opts,
        signal,
      });
    }

    return this.client.mutation<
      GenerateCopilotResponseMutation,
      GenerateCopilotResponseMutationVariables
    >(
      generateCopilotResponseMutation,
      { data, properties },
      { fetch: fetchWithAbortSignal as any },
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
