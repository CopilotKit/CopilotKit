import { Client, cacheExchange, fetchExchange } from "@urql/core";
import * as packageJson from "../../package.json";
import {
  AvailableAgentsQuery,
  GenerateCopilotResponseMutation,
  GenerateCopilotResponseMutationVariables,
  LoadAgentStateQuery,
} from "../graphql/@generated/graphql";
import { generateCopilotResponseMutation } from "../graphql/definitions/mutations";
import { getAvailableAgentsQuery, loadAgentStateQuery } from "../graphql/definitions/queries";
import { OperationResultSource, OperationResult } from "urql";
import {
  ResolvedCopilotKitError,
  CopilotKitLowLevelError,
  CopilotKitError,
  CopilotKitVersionMismatchError,
  getPossibleVersionMismatch,
} from "@copilotkit/shared";

const createFetchFn =
  (signal?: AbortSignal, handleGQLWarning?: (warning: string) => void) =>
  async (...args: Parameters<typeof fetch>) => {
    // @ts-expect-error -- since this is our own header, TS will not recognize
    const publicApiKey = args[1]?.headers?.["x-copilotcloud-public-api-key"];
    try {
      const result = await fetch(args[0], { ...(args[1] ?? {}), signal });

      // No mismatch checking if cloud is being used
      const mismatch = publicApiKey
        ? null
        : await getPossibleVersionMismatch({
            runtimeVersion: result.headers.get("X-CopilotKit-Runtime-Version")!,
            runtimeClientGqlVersion: packageJson.version,
          });
      if (result.status !== 200) {
        if (result.status >= 400 && result.status <= 500) {
          if (mismatch) {
            throw new CopilotKitVersionMismatchError(mismatch);
          }

          throw new ResolvedCopilotKitError({ status: result.status });
        }
      }

      if (mismatch && handleGQLWarning) {
        handleGQLWarning(mismatch.message);
      }

      return result;
    } catch (error) {
      // Let abort error pass through. It will be suppressed later
      if (
        (error as Error).message.includes("BodyStreamBuffer was aborted") ||
        (error as Error).message.includes("signal is aborted without reason")
      ) {
        throw error;
      }
      if (error instanceof CopilotKitError) {
        throw error;
      }
      throw new CopilotKitLowLevelError({ error: error as Error, url: args[0] as string });
    }
  };

export interface CopilotRuntimeClientOptions {
  url: string;
  publicApiKey?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  handleGQLErrors?: (error: Error) => void;
  handleGQLWarning?: (warning: string) => void;
}

export class CopilotRuntimeClient {
  client: Client;
  public handleGQLErrors?: (error: Error) => void;
  public handleGQLWarning?: (warning: string) => void;

  constructor(options: CopilotRuntimeClientOptions) {
    const headers: Record<string, string> = {};

    this.handleGQLErrors = options.handleGQLErrors;
    this.handleGQLWarning = options.handleGQLWarning;

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
    const fetchFn = createFetchFn(signal, this.handleGQLWarning);
    const result = this.client.mutation<
      GenerateCopilotResponseMutation,
      GenerateCopilotResponseMutationVariables
    >(generateCopilotResponseMutation, { data, properties }, { fetch: fetchFn });

    // Add error handling for GraphQL errors that occur during mutation execution
    result.subscribe(({ error }) => {
      if (error && this.handleGQLErrors) {
        this.handleGQLErrors(error);
      }
    });

    return result;
  }

  public asStream<S, T>(source: OperationResultSource<OperationResult<S, { data: T }>>) {
    const handleGQLErrors = this.handleGQLErrors;
    return new ReadableStream<S>({
      start(controller) {
        source.subscribe(({ data, hasNext, error }) => {
          if (error) {
            if (
              error.message.includes("BodyStreamBuffer was aborted") ||
              error.message.includes("signal is aborted without reason")
            ) {
              // close the stream if there is no next item
              if (!hasNext) controller.close();

              //suppress this specific error
              console.warn("Abort error suppressed");
              return;
            }

            // Handle structured errors specially - check if it's a CopilotKitError with visibility
            if ((error as any).extensions?.visibility) {
              // Create a synthetic GraphQL error with the structured error info
              const syntheticError = {
                ...error,
                graphQLErrors: [
                  {
                    message: error.message,
                    extensions: (error as any).extensions,
                  },
                ],
              };

              if (handleGQLErrors) {
                handleGQLErrors(syntheticError);
              }
              return; // Don't close the stream for structured errors, let the error handler decide
            }

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

  availableAgents() {
    const fetchFn = createFetchFn();
    return this.client.query<AvailableAgentsQuery>(getAvailableAgentsQuery, {}, { fetch: fetchFn });
  }

  loadAgentState(data: { threadId: string; agentName: string }) {
    const fetchFn = createFetchFn();
    const result = this.client.query<LoadAgentStateQuery>(
      loadAgentStateQuery,
      { data },
      { fetch: fetchFn },
    );

    // Add error handling for GraphQL errors - similar to generateCopilotResponse
    result
      .toPromise()
      .then(({ error }) => {
        if (error && this.handleGQLErrors) {
          this.handleGQLErrors(error);
        }
      })
      .catch(() => {}); // Suppress promise rejection warnings

    return result;
  }

  static removeGraphQLTypename(data: any) {
    if (Array.isArray(data)) {
      data.forEach((item) => CopilotRuntimeClient.removeGraphQLTypename(item));
    } else if (typeof data === "object" && data !== null) {
      delete data.__typename;
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === "object" && data[key] !== null) {
          CopilotRuntimeClient.removeGraphQLTypename(data[key]);
        }
      });
    }
    return data;
  }
}
