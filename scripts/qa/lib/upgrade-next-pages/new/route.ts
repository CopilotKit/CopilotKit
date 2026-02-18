import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSPagesRouterEndpoint,
} from "@copilotkit/runtime";
import { NextApiRequest, NextApiResponse } from "next";

const serviceAdapter = new OpenAIAdapter();

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
        return "The person has been roasted.";
      },
    },
  ],
});

// This is required for file upload to work
export const config = {
  api: {
    bodyParser: false,
  },
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const handleRequest = copilotRuntimeNextJSPagesRouterEndpoint({
    endpoint: "/api/copilotkit",
    runtime,
    serviceAdapter,
  });

  return await handleRequest(req, res);
};

export default handler;
