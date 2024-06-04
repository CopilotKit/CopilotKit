import { Client, cacheExchange, fetchExchange } from "@urql/core";
import {
  GenerateResponseMutation,
  GenerateResponseMutationVariables,
} from "../graphql/@generated/graphql";
import { generateResponseMutation } from "../graphql/mutations";

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
    return this.client.mutation<
      GenerateResponseMutation,
      GenerateResponseMutationVariables
    >(generateResponseMutation, { data });
  }
}
