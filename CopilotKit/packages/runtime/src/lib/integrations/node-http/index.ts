import { createYoga } from "graphql-yoga";
import { getCommonConfig } from "../shared";
import { CopilotRuntime } from "../../copilot-runtime";
import { CopilotServiceAdapter } from "../../../service-adapters";

export function copilotRuntimeNodeHttpEndpoint({
  runtime,
  endpoint,
  serviceAdapter,
}: {
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
  endpoint: string;
}) {
  const commonConfig = getCommonConfig({ runtime, serviceAdapter });

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: endpoint,
  });

  return yoga;
}
