import { Action } from "@copilotkit/shared";
import { researchWithLangGraph } from "./research";

import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  LangChainAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { ChatOpenAI } from "@langchain/openai";

const researchAction: Action<any> = {
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

const actions: Action<any>[] = [];
if (process.env["TAVILY_API_KEY"] && process.env["TAVILY_API_KEY"] !== "NONE") {
  actions.push(researchAction);
}

const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
  apiKey: process.env["OPENAI_API_KEY"],
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime({
      actions: actions,
    }),
    serviceAdapter: new LangChainAdapter({
      chainFn: async ({ messages, tools, threadId }) => {
        console.log("POST messages: ", messages)
        console.log("POST tools: ", Object.keys(tools))
        console.log("POST tools: ", tools.map(tool => {
          return {
            name: tool.lc_kwargs.name,
            func: JSON.stringify(tool.lc_kwargs.func)
          }
        }))
        console.log("POST threadId: ", threadId)
        const modelWithTools = model.bindTools(tools, { strict: true });
        return modelWithTools.stream(messages, { tools, metadata: { conversation_id: threadId } });
      },
    }),
    endpoint: req.nextUrl.pathname,
  });
  return handleRequest(req);
};
