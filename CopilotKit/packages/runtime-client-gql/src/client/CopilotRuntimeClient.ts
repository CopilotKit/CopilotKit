import { Client, cacheExchange, fetchExchange } from "@urql/core";
import * as packageJson from "../../package.json";

import {
  GenerateCopilotResponseMutation,
  GenerateCopilotResponseMutationVariables,
} from "../graphql/@generated/graphql";
import { generateCopilotResponseMutation } from "../graphql/definitions/mutations";
import { OperationResultSource, OperationResult } from "urql";

export interface CopilotRuntimeClientOptions {
  url: string;
  publicApiKey?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  handleGQLErrors?: (error: Error) => void;
}

export class CopilotRuntimeClient {
  client: Client;
  public handleGQLErrors?: (error: Error) => void;

  constructor(options: CopilotRuntimeClientOptions) {
    const headers: Record<string, string> = {};

    this.handleGQLErrors = options.handleGQLErrors;

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
        headers: {
          ...headers,
          "X-CopilotKit-Runtime-Client-GQL-Version": packageJson.version,
        },
        ...(options.credentials ? { credentials: options.credentials } : {}),
      },
    });
  }

  generateCopilotResponse({
    data,
    properties,
    signal,
  }: {
    data: GenerateCopilotResponseMutationVariables["data"];
    properties?: GenerateCopilotResponseMutationVariables["properties"];
    signal?: AbortSignal;
  }) {
    const fetchFn = async (...args: Parameters<typeof fetch>) => {
      const result = await fetch(args[0], { ...(args[1] ?? {}), signal });
      if (result.status !== 200) {
        switch (result.status) {
          case 404:
            throw new Error(
              "Runtime URL seems to be invalid - got 404 response. Please check the runtimeUrl passed to CopilotKit",
            );
          default:
            throw new Error("Could not fetch copilot response");
        }
      }
      return result;
    };
    const result = this.client.mutation<
      GenerateCopilotResponseMutation,
      GenerateCopilotResponseMutationVariables
    >(generateCopilotResponseMutation, { data, properties }, { fetch: fetchFn });

    return result;
  }

  public asStream<S, T>(source: OperationResultSource<OperationResult<S, { data: T }>>) {
    const handleGQLErrors = this.handleGQLErrors;
    return new ReadableStream<S>({
      start(controller) {
        source.subscribe(({ data, hasNext, error }) => {
          if (error) {
            controller.error(error);
            if (handleGQLErrors) {
              handleGQLErrors(error);
            }
          } else {
            controller.enqueue(data);
            if (!hasNext) {
              controller.close();
            }
          }
        });
      },
    });
  }
}
