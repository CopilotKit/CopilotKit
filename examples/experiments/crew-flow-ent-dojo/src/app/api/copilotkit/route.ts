import { CrewFlowAgUiClient } from "@/agui-clients/crew-flow/ag-ui-client";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { NextRequest } from "next/server";

/**
 * Get flow details - toggle between real and mock implementations
 */
const getFlowDetails = (
  agent: string
): {
  flowUrl: string;
  apiKey: string;
  webhookUrl: string;
  realtime: boolean;
} => {
  const agents = {
    shared_state: {
      flowUrl:
        "https://shared-state-d8c2194f-64c1-4530-9f4d-d35749-727eb5e6.crewai.com",
      apiKey: "7f536dbb9502",
      webhookUrl: "https://api.cloud.stagingcopilotkit.ai/webhooks/flows",
      realtime: false,
    },
    agentic_chat: {
      flowUrl:
        "https://agentic-chat-34890e47-4cab-4445-bb1e-020078-69f6120f.crewai.com",
      apiKey: "e0ba60f6158e",
      webhookUrl: "https://api.cloud.stagingcopilotkit.ai/webhooks/flows",
      realtime: true,
    },
    human_in_the_loop: {
      flowUrl:
        "https://human-in-the-loop-b28c67bc-eccf-4a28-afae-d-b648a9ee.crewai.com",
      apiKey: "cb1012e6564d",
      webhookUrl: "https://api.cloud.stagingcopilotkit.ai/webhooks/flows",
      realtime: true,
    },
    tool_based_generative_ui: {
      flowUrl:
        "https://tool-based-generative-ui-1e4bb0fb-e728-4b6e-5bb680bc.crewai.com",
      apiKey: "7ad634b760f9",
      webhookUrl: "https://api.cloud.stagingcopilotkit.ai/webhooks/flows",
      realtime: true,
    },
    agentic_generative_ui: {
      flowUrl:
        "https://agentic-generative-ui-7293f7d2-b20e-44ac-82-31970d35.crewai.com",
      apiKey: "911f1e4a0e3a",
      webhookUrl: "https://api.cloud.stagingcopilotkit.ai/webhooks/flows",
      realtime: true,
    },
    predictive_state_updates: {
      flowUrl:
        "https://predictive-state-updates-ede99fce-9f40-4fac-b3e8efdc.crewai.com",
      apiKey: "c8f8743ea173",
      webhookUrl: "https://api.cloud.stagingcopilotkit.ai/webhooks/flows",
      realtime: true,
    },
  };

  return agents[agent as keyof typeof agents];
};

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime({
      agents: {
        agentic_chat: new CrewFlowAgUiClient(getFlowDetails("agentic_chat")),
        shared_state: new CrewFlowAgUiClient(getFlowDetails("shared_state")),
        human_in_the_loop: new CrewFlowAgUiClient(
          getFlowDetails("human_in_the_loop")
        ),
        agentic_generative_ui: new CrewFlowAgUiClient(
          getFlowDetails("agentic_generative_ui")
        ),
        tool_based_generative_ui: new CrewFlowAgUiClient(
          getFlowDetails("tool_based_generative_ui")
        ),
        predictive_state_updates: new CrewFlowAgUiClient(
          getFlowDetails("predictive_state_updates")
        ),
      },
    }),
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
