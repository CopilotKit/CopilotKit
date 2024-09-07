import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit-alt/runtime";
import { NextRequest } from "next/server";

// -----------------
// To run this example:
// - clone https://github.com/mme/gpt-newspaper
// - follow the instructions in NOTES.md
// -----------------

export const POST = async (req: NextRequest) => {
  const runtime = new CopilotRuntime({
    actions: [
      {
        name: "research",
        description:
          "Call this function when the user requests research on a certain topic. After researching, make a presentation.",
        parameters: [
          {
            name: "topic",
            type: "string",
            description: "The topic to research.",
          },
        ],
        handler: async ({ topic }) => {
          const response = await fetch("http://localhost:8000/generate_newspaper_html", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              topics: [topic],
              layout: "layout_1.html",
            }),
          });

          // return the html from the newspaper generator
          return await response.text();
        },
      },
    ],
  });

  const serviceAdapter = new OpenAIAdapter();

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
