import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { researchWithLangGraph } from "./research";
import { Action } from "@copilotkit/shared";
import { NextRequest } from "next/server";

export const runtime = "edge";

const researchAction = {
  name: "research",
  description:
    "Call this function to conduct research on a certain topic. Respect other notes about when to call this function",
  parameters: [
    {
      name: "topic",
      type: "string",
      description: "The topic to research. 5 characters or longer.",
    },
  ],
  handler: async ({ topic }) => {
    console.log("Researching topic: ", topic);
    return await researchWithLangGraph(topic);
  },
};

export const POST = async (req: NextRequest) => {
  const serviceAdapter = new OpenAIAdapter();

  const env = process.env;
  const actions: Action<any>[] = [];
  if (env["TAVILY_API_KEY"]) {
    actions.push(researchAction);
  }
  const runtime = new CopilotRuntime({ actions });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
