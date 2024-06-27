import {
  CopilotRuntime,
  LangChainAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { ChatOpenAI } from "@langchain/openai";

const runtime = new CopilotRuntime({
  actions: [
    {
      name: "sayHello",
      description: "Says hello to someone.",
      parameters: [
        {
          name: "arg",
          type: "string",
          description: "The name of the person to say hello to.",
          required: true,
        },
      ],
      handler: async ({ arg }) => {
        console.log("Hello from the server", arg, "!");
      },
    },
  ],
});

const serviceAdapter = new LangChainAdapter({
  chainFn: async ({ messages, tools }) => {
    const model = new ChatOpenAI({ modelName: "gpt-4-1106-preview" }).bind(tools as any);
    return model.stream(messages);
  },
});

export const { GET, POST, OPTIONS } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/api/copilotkit/langchain",
  debug: true,
}) as any;
