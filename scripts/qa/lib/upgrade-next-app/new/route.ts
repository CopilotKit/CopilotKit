import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

const runtime = new CopilotRuntime({
  actions: [
    {
      name: "sayHello",
      description: "say hello so someone by roasting their name",
      parameters: [
        {
          name: "roast",
          description: "A sentence or two roasting the name of the person",
          type: "string",
          required: true,
        },
      ],
      handler: ({ roast }) => {
        console.log(roast);
      },
    },
  ],
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new OpenAIAdapter(),
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
