import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";
import { jsonSchemaToZod } from "./tanstack-factory";

const MCP_APPS_SYSTEM_PROMPT = `\
You draw simple diagrams in Excalidraw via the MCP \`create_view\` tool.

SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize for
polish. Target: one tool call, done in seconds.

When the user asks for a diagram:
1. Call \`create_view\` ONCE with 3-5 elements total: shapes + arrows + an
   optional title text.
2. Use straightforward shapes (rectangle, ellipse, diamond) with plain
   \`label\` fields ({"text": "...", "fontSize": 18}) on them.
3. Connect with arrows. Endpoints can be element centers or simple
   coordinates — no edge anchors needed.
4. Include ONE \`cameraUpdate\` at the END of the elements array that frames
   the whole diagram. Use 4:3 (e.g. 600x450). No opening camera needed.
5. Reply with ONE short sentence describing what you drew.

Every element needs a unique string \`id\`. Do NOT call \`read_me\`, do NOT
make multiple \`create_view\` calls, do NOT iterate or refine.`;

/**
 * Built-in agent for the MCP Apps demo.
 *
 * The runtime's `mcpApps.servers` config makes `MCPAppsMiddleware` fetch the
 * remote MCP server's tools and merge them into `input.tools` at request
 * time. We MUST declare those tools to `chat()`, or the model never sees
 * `create_view` and replies with plain text instead of rendering the
 * Excalidraw view.
 *
 * Tools are declared via `toolDefinition()` (same pattern as
 * `tanstack-factory.ts`) rather than reusing `convertInputToTanStackAI`'s
 * `tools`, because that field only exists in @copilotkit/runtime >= 1.61.0
 * and this app pins 1.60.2.
 */
export function createMcpAppsAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      const tools = (input.tools ?? []).map((t) =>
        toolDefinition({
          name: t.name,
          description: t.description ?? "",
          inputSchema: jsonSchemaToZod(t.parameters),
        }),
      );
      return chat({
        adapter: openaiText("gpt-4o-mini", { fetch: forwardingFetch }),
        messages,
        systemPrompts: [MCP_APPS_SYSTEM_PROMPT, ...systemPrompts],
        tools,
        abortController,
      });
    },
  });
}
