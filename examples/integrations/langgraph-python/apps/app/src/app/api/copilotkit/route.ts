import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";
import { z } from "zod";
import { demonstrationCatalogDefinitions } from "../../declarative-generative-ui/definitions";

/**
 * Convert a Zod schema to a JSON Schema object.
 * Handles the common Zod types used in catalog definitions.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def;
  const typeName = def?.typeName;

  switch (typeName) {
    case "ZodString":
      return { type: "string", ...(schema.description ? { description: schema.description } : {}) };
    case "ZodNumber":
      return { type: "number", ...(schema.description ? { description: schema.description } : {}) };
    case "ZodBoolean":
      return { type: "boolean", ...(schema.description ? { description: schema.description } : {}) };
    case "ZodEnum":
      return { type: "string", enum: def.values, ...(schema.description ? { description: schema.description } : {}) };
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault":
      return zodToJsonSchema(def.innerType);
    case "ZodArray":
      return { type: "array", items: zodToJsonSchema(def.type), ...(schema.description ? { description: schema.description } : {}) };
    case "ZodObject": {
      const shape = (schema as z.ZodObject<any>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
        if ((value as any)._def?.typeName !== "ZodOptional") {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        ...(schema.description ? { description: schema.description } : {}),
      };
    }
    case "ZodRecord":
      return { type: "object", additionalProperties: zodToJsonSchema(def.valueType) };
    case "ZodAny":
      return {};
    default:
      return { type: "string" }; // fallback
  }
}

// Extract full JSON Schema from Zod definitions for the A2UI middleware.
const demonstrationSchema = Object.entries(demonstrationCatalogDefinitions).map(
  ([name, def]) => ({
    name,
    description: def.description,
    props: zodToJsonSchema(def.props),
  }),
);

const defaultAgent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime: new CopilotRuntime({
      agents: { default: defaultAgent },
      a2ui: {
        injectA2UITool: true,
        schema: demonstrationSchema,
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
