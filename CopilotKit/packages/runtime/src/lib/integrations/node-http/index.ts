import { createYoga } from "graphql-yoga";
import { getCommonConfig } from "../shared";
import { CopilotRuntime } from "../../copilot-runtime";
import { CopilotServiceAdapter } from "../../../service-adapters";

export function copilotRuntimeNodeHttpEndpoint({
  runtime,
  endpoint,
  serviceAdapter,
  debug,
}: {
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
  endpoint: string;
  debug?: boolean;
}) {
  const commonConfig = getCommonConfig({ runtime, serviceAdapter, debug });

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: endpoint,
  });

  return yoga;
}
