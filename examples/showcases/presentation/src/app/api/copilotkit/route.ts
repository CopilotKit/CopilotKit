import { researchWithLangGraph } from "./research";
import { Action } from "@copilotkit/shared";
import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
  OpenAIAdapter,
} from "@copilotkit/runtime";

const UNSPLASH_ACCESS_KEY_ENV = "UNSPLASH_ACCESS_KEY";
const UNSPLASH_ACCESS_KEY = process.env[UNSPLASH_ACCESS_KEY_ENV];

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

export const POST = async (req: NextRequest) => {
  const actions: Action<any>[] = [
    {
      name: "getImageUrl",
      description: "Get an image url for a topic",
      parameters: [
        {
          name: "topic",
          description: "The topic of the image",
        },
      ],
      handler: async ({ topic }) => {
        if (UNSPLASH_ACCESS_KEY) {
          const response = await fetch(
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
              topic
            )}&per_page=10&order_by=relevant&content_filter=high`,
            {
              headers: {
                Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
              },
            }
          );
          const data = await response.json();
          if (data.results && data.results.length > 0) {
            const randomIndex = Math.floor(Math.random() * data.results.length);
            return data.results[randomIndex].urls.regular;
          }
        }
        return (
          'url("https://loremflickr.com/800/600/' +
          encodeURIComponent(topic) +
          '")'
        );
      },
    },
  ];

  if (
    process.env["TAVILY_API_KEY"] &&
    process.env["TAVILY_API_KEY"] !== "NONE"
  ) {
    actions.push(researchAction);
  }

  const openaiModel = process.env["OPENAI_MODEL"];

  console.log("ENV.COPILOT_CLOUD_API_KEY", process.env.COPILOT_CLOUD_API_KEY);

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime({ actions }),
    serviceAdapter: new OpenAIAdapter({ model: openaiModel }),
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
