/**
 * LangGraph TypeScript agent for the CopilotKit MCP Apps demo.
 *
 * This agent has no bespoke tools — the CopilotKit runtime is wired with
 * `mcpApps: { servers: [...] }` pointing at the public Excalidraw MCP
 * server (see `src/app/api/copilotkit-mcp-apps/route.ts`). The runtime
 * auto-applies the MCP Apps middleware which exposes the remote MCP
 * server's tools to this agent at request time and emits the activity
 * events that CopilotKit's built-in `MCPAppsActivityRenderer` renders in
 * the chat as a sandboxed iframe.
 *
 * Ported from `src/agents/mcp_apps_agent.py`.
 *
 * NOTE: The TS runtime performs MCP tool injection via the A2UI/MCP-Apps
 * middleware before the graph sees the request. The graph itself doesn't
 * need bespoke MCP client wiring.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  END,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

const SYSTEM_PROMPT = `You draw simple diagrams in Excalidraw via the MCP tool.

SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize
for polish. Target: one tool call, done in seconds.

When the user asks for a diagram:
1. Call \`create_view\` ONCE with 3-5 elements total: shapes + arrows +
   an optional title text.
2. Use straightforward shapes (rectangle, ellipse, diamond) with plain
   \`label\` fields (\`{"text": "...", "fontSize": 18}\`) on them.
3. Connect with arrows. Endpoints can be element centers or simple
   coordinates — you don't need edge anchors / fixedPoint bindings.
4. Include ONE \`cameraUpdate\` at the END of the elements array that
   frames the whole diagram. Use an approved 4:3 size (600x450 or
   800x600). No opening camera needed.
5. Reply with ONE short sentence describing what you drew.

Every element needs a unique string \`id\` (e.g. \`"b1"\`, \`"a1"\`,
\`"title"\`). Standard sizes: rectangles 160x70, ellipses/diamonds
120x80, 40-80px gap between shapes.

Do NOT:
- Call \`read_me\`. You already know the basic shape API.
- Make multiple \`create_view\` calls.
- Iterate or refine. Ship on the first shot.
- Add decorative colors / fills / zone backgrounds unless the user
  explicitly asks for them.
- Add labels on arrows unless crucial.

If the user asks for something specific (colors, more elements,
particular layout), follow their lead — but still in ONE call.`;

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

export type AgentState = typeof AgentStateAnnotation.State;

async function chatNode(state: AgentState, config: RunnableConfig) {
  // gpt-4o-mini for speed — Excalidraw element emission is simple JSON and
  // we're biasing hard toward sub-30s generation.
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  // The MCP Apps middleware injects MCP tools into state.copilotkit.actions
  // alongside any frontend actions, so a single bind picks up everything.
  const copilotActions = convertActionsToDynamicStructuredTools(
    state.copilotkit?.actions ?? [],
  );

  const modelWithTools =
    copilotActions.length > 0 ? model.bindTools!(copilotActions) : model;

  const systemMessage = new SystemMessage({ content: SYSTEM_PROMPT });

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config,
  );

  return { messages: response };
}

function shouldContinue({ messages }: AgentState) {
  const lastMessage = messages[messages.length - 1] as AIMessage;
  // All tool calls are frontend (MCP-injected) actions — never locally
  // handled. End the run and let the runtime dispatch them.
  return lastMessage.tool_calls?.length ? END : END;
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
