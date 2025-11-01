import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
import { experimental_createMCPClient } from "ai";
import { copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { NextRequest } from "next/server";

const serviceAdapter = new OpenAIAdapter();

const runtime = new CopilotRuntime({
  actions: [
    {
      name: "getWeather",
      description: "Get the current weather for a location",
      parameters: [
        {
          name: "location",
          type: "string",
          description: "The city and state, e.g. San Francisco, CA",
          required: true,
        },
      ],
      handler: async ({ location }) => {
        // Simulate weather API call
        const weatherData = {
          location,
          temperature: Math.floor(Math.random() * 30) + 50,
          condition: ["sunny", "cloudy", "rainy", "snowy"][Math.floor(Math.random() * 4)],
          humidity: Math.floor(Math.random() * 40) + 30,
        };
        
        return `The weather in ${weatherData.location} is ${weatherData.condition} with a temperature of ${weatherData.temperature}°F and ${weatherData.humidity}% humidity.`;
      },
    },
  ],
  mcpServers: [
    { endpoint: "https://your-mcp-server.com/sse" }
  ],
  async createMCPClient(config) {
    return await experimental_createMCPClient({
      transport: {
        type: "sse",
        url: config.endpoint,
        headers: config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : undefined,
      },
    });
  }
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
