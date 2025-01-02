import {
  CopilotRuntimeClient,
  CopilotRuntimeClientOptions,
  GraphQLError,
} from "@copilotkit/runtime-client-gql";
import { useToast } from "../components/toast/toast-provider";
import { useMemo } from "react";
import { useErrorToast } from "../components/error-boundary/error-utils";

export const useCopilotRuntimeClient = (options: CopilotRuntimeClientOptions) => {
  const { addGraphQLErrorsToast } = useToast();
  const addErrorToast = useErrorToast();

  const runtimeClient = useMemo(() => {
    return new CopilotRuntimeClient({
      ...options,
      handleGQLErrors: (error) => {
        if ((error as any).graphQLErrors.length) {
          addGraphQLErrorsToast((error as any).graphQLErrors as GraphQLError[]);
        } else {
          addErrorToast([error]);
        }
      },
    });
  }, [options, addGraphQLErrorsToast]);

  return runtimeClient;
};
