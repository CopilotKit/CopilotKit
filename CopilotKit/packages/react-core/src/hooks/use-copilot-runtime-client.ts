import {
  CopilotRuntimeClient,
  CopilotRuntimeClientOptions,
  GraphQLError,
} from "@copilotkit/runtime-client-gql";
import { useToast } from "../components/toast/toast-provider";

export const useCopilotRuntimeClient = (options: CopilotRuntimeClientOptions) => {
  const { addGraphQLErrorsToast } = useToast();

  const runtimeClient = new CopilotRuntimeClient({
    ...options,
    handleGQLErrors: (error) => {
      if ((error as any).graphQLErrors.length) {
        addGraphQLErrorsToast((error as any).graphQLErrors as GraphQLError[]);
      }
    },
  });
  return runtimeClient;
};
