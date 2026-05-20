import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

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
 * No bespoke tools — the runtime's `mcpApps.servers` config auto-applies the
 * MCP Apps middleware which exposes the remote MCP server's tools at
 * request time.
 */
export function createMcpAppsAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      return chat({
        adapter: openaiText("gpt-4o-mini"),
        messages,
        systemPrompts: [MCP_APPS_SYSTEM_PROMPT, ...systemPrompts],
        tools: [],
        abortController,
      });
    },
  });
}
