import {
  CopilotRuntimeClient,
  CopilotRuntimeClientOptions,
  GraphQLError,
} from "@copilotkit/runtime-client-gql";
import { useToast } from "../components/toast/toast-provider";
import { useMemo } from "react";

export const useCopilotRuntimeClient = (options: CopilotRuntimeClientOptions) => {
  const { addGraphQLErrorsToast } = useToast();

  const runtimeClient = useMemo(() => {
    return new CopilotRuntimeClient({
      ...options,
      handleGQLErrors: (error) => {
        if ((error as any).graphQLErrors.length) {
          addGraphQLErrorsToast((error as any).graphQLErrors as GraphQLError[]);
        }
      },
    });
  }, [options, addGraphQLErrorsToast]);

  return runtimeClient;
};
