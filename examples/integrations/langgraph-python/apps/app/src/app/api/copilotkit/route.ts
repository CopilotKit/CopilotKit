import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";
import flightSchema from "./a2ui_flight_schema.json";
import bookedSchema from "../../../a2ui/booked-confirmation.json";

// 1. Define the agent connection to LangGraph
const defaultAgent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

// 3. Define the route and CopilotRuntime for the agent
export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime: new CopilotRuntime({
      agents: { default: defaultAgent },
      a2ui: {
        injectA2UITool: true,
        streamingSurfaces: [
          {
            toolName: "search_flights_streaming",
            surface: {
              surfaceId: "flight-search-streaming",
              root: "root",
              components: flightSchema,
              dataKey: "flights",
              actionHandlers: {
                book_flight: [
                  {
                    surfaceUpdate: {
                      surfaceId: "flight-search-streaming",
                      components: bookedSchema,
                    },
                  },
                  {
                    dataModelUpdate: {
                      surfaceId: "flight-search-streaming",
                      contents: [
                        { key: "title", valueString: "Booking Confirmed" },
                        {
                          key: "detail",
                          valueString:
                            "Your flight has been booked successfully.",
                        },
                        { key: "reference", valueString: "CK-38291" },
                      ],
                    },
                  },
                  {
                    beginRendering: {
                      surfaceId: "flight-search-streaming",
                      root: "root",
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      mcpApps: {
        servers: [
          {
            type: "http",
            url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
            serverId: "example_mcp_app",
          },
        ],
      },
    }),
  });

  return handleRequest(req);
};
