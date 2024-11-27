import { NextRequest } from "next/server";
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { getServiceAdapter } from "../../../lib/dynamic-service-adapter";

const UNSPLASH_ACCESS_KEY_ENV = "UNSPLASH_ACCESS_KEY";
const UNSPLASH_ACCESS_KEY = process.env[UNSPLASH_ACCESS_KEY_ENV];

const runtime = new CopilotRuntime({
  actions: [
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
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(topic)}&per_page=10&order_by=relevant&content_filter=high`,
            {
              headers: {
                Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
              },
            },
          );
          const data = await response.json();
          if (data.results && data.results.length > 0) {
            const randomIndex = Math.floor(Math.random() * data.results.length);
            return data.results[randomIndex].urls.regular;
          }
        }
        return 'url("https://loremflickr.com/800/600/' + encodeURIComponent(topic) + '")';
      },
    },
  ],
});

export const POST = async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const serviceAdapterQueryParam = searchParams.get("serviceAdapter") || "openai";
  const serviceAdapter = await getServiceAdapter(serviceAdapterQueryParam);

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
