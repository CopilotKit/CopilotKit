import {
  CopilotRuntime,
  LangChainAdapter,
  ExperimentalGroqAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BaseMessageLike } from "@langchain/core/messages";

import { ChatGroq } from "@langchain/groq";
import { BaseMessage } from "@langchain/core/messages";
import { NextRequest } from "next/server";

export const POST = async (req: NextRequest) => {
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

  // const serviceAdapter = new LangChainAdapter({
  //   chainFn: async ({ messages, tools }) => {
  //     const model = new ChatGroq({ modelName: "llama3-groq-70b-8192-tool-use-preview" });
  //     const b = model.stream([], {  });
  //     // return model.stream(messages, { tools });
  //   },
  // });

  const serviceAdapter = new ExperimentalGroqAdapter();

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
