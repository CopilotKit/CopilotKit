// ---------------------------------------------------------------------------
// tkt-enum-dropped: V2 tool payload drops enum from parameter definitions
//
// Issue: useCopilotAction with { type: "string", enum: ["todo","done"] }
// sends the enum in V1's jsonSchema payload but drops it in V2's parameters
// object.
//
// Root cause: V1's use-frontend-tool.ts bridge calls getZodParameters()
// → convertJsonSchemaToZodSchema() which converts string+enum to z.string()
// (dropping enum). The Zod schema is passed to V2's useFrontendTool, which
// converts back to JSON schema via zodToJsonSchema() — enum is already lost.
//
// Slack thread:
// https://copilotkit.slack.com/archives/C09C1BLEPC1/p1771446879295189
// ---------------------------------------------------------------------------

import { CopilotRuntime } from "@copilotkitnext/runtime";
import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { HttpAgent } from "@ag-ui/client";

const agentBaseUrl =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";

const agentUrl = `${agentBaseUrl}/tickets/tkt-enum-dropped`;

console.log("[tkt-enum-dropped server] Agent URL:", agentUrl);

const agent = new HttpAgent({
  url: agentUrl,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },

  beforeRequestMiddleware: async ({ request, path }) => {
    console.log("[tkt-enum-dropped server] ──────────────────────────────────");
    console.log("[tkt-enum-dropped server] beforeRequestMiddleware CALLED");
    console.log("[tkt-enum-dropped server] path:", path);

    // Clone the request so we can read the body without consuming it
    const cloned = request.clone();
    try {
      const body = await cloned.text();
      const parsed = JSON.parse(body);

      // Single-endpoint wraps the payload in { method, params, body }
      const payload = parsed.body ?? parsed;

      // Log the tool definitions — this is where we can see if enum is present
      if (payload.tools) {
        console.log(
          "[tkt-enum-dropped server] tools received by runtime:",
        );
        for (const tool of payload.tools) {
          console.log(
            `[tkt-enum-dropped server]   tool "${tool.name}":`,
            JSON.stringify(tool, null, 2),
          );

          // Specifically check for enum in parameters
          if (tool.parameters?.properties) {
            for (const [propName, propDef] of Object.entries(
              tool.parameters.properties as Record<string, any>,
            )) {
              if ((propDef as any).enum) {
                console.log(
                  `[tkt-enum-dropped server]   ✅ "${propName}" HAS enum:`,
                  (propDef as any).enum,
                );
              } else if (propName === "status") {
                console.log(
                  `[tkt-enum-dropped server]   ❌ "${propName}" MISSING enum — should be ["todo","done"]`,
                );
              }
            }
          }
        }
      }

      // Also check V1-style actions (jsonSchema as string)
      if (payload.actions) {
        console.log(
          "[tkt-enum-dropped server] V1-style actions received:",
        );
        for (const action of payload.actions) {
          console.log(
            `[tkt-enum-dropped server]   action "${action.name}":`,
            JSON.stringify(action, null, 2),
          );
          if (action.jsonSchema) {
            const schema = JSON.parse(action.jsonSchema);
            if (schema.properties?.status?.enum) {
              console.log(
                `[tkt-enum-dropped server]   ✅ V1 jsonSchema has enum:`,
                schema.properties.status.enum,
              );
            }
          }
        }
      }
    } catch (err: any) {
      console.error(
        "[tkt-enum-dropped server] Failed to parse request body:",
        err.message,
      );
    }
    console.log("[tkt-enum-dropped server] ──────────────────────────────────");
  },
});

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/",
});

console.log(
  "[tkt-enum-dropped server] Endpoint created at /api/tickets/tkt-enum-dropped/copilot",
);

// Export a handler compatible with the Fastify bridge (Request → Response).
export const handler = (request: Request) => {
  const url = new URL(request.url);
  console.log(
    "[tkt-enum-dropped server] Incoming request:",
    request.method,
    url.pathname,
  );
  url.pathname = "/";
  return app.fetch(new Request(url, request));
};
