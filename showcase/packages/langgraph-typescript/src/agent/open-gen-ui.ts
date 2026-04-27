/**
 * LangGraph TypeScript agent backing the Open-Ended Generative UI demo (minimal).
 *
 * Port of `langgraph-python/src/agents/open_gen_ui_agent.py`.
 *
 * The agent does not define its own tools. All the interesting work happens
 * outside the agent:
 *
 * - The frontend-registered `generateSandboxedUi` tool (auto-registered by
 *   `CopilotKitProvider` when the runtime has `openGenerativeUI` enabled)
 *   arrives in `state.copilotkit.actions`. `convertActionsToDynamicStructuredTools`
 *   turns that into a LangChain tool definition bound on the model call.
 * - When the LLM calls `generateSandboxedUi`, the runtime's
 *   `OpenGenerativeUIMiddleware` (enabled via `openGenerativeUI` in the
 *   Next.js route — see `src/app/api/copilotkit-ogui/route.ts`) converts
 *   that streaming tool call into `open-generative-ui` activity events that
 *   the built-in renderer mounts inside a sandboxed iframe.
 *
 * This is the minimal variant: no sandbox functions, no app-side tools.
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

const SYSTEM_PROMPT = `You are a UI-generating assistant for an Open Generative UI demo
focused on intricate, educational visualisations (3D axes / rotations,
neural-network activations, sorting-algorithm walkthroughs, Fourier
series, wave interference, planetary orbits, etc.).

On every user turn you MUST call the \`generateSandboxedUi\` frontend tool
exactly once. Design a visually polished, self-contained HTML + CSS +
SVG widget that *teaches* the requested concept.

The frontend injects a detailed "design skill" as agent context
describing the palette, typography, labelling, and motion conventions
expected — follow it closely. Key invariants:
- Use inline SVG (or <canvas>) for geometric content, not stacks of <div>s.
- Every axis is labelled; every colour-coded series has a legend.
- Prefer CSS @keyframes / transitions over setInterval; loop cyclical
  concepts with animation-iteration-count: infinite.
- Motion must teach — animate the actual step of the concept, not decoration.
- No fetch / XHR / localStorage — the sandbox has no same-origin access.

Output order:
- \`initialHeight\` (typically 480-560 for visualisations) first.
- A short \`placeholderMessages\` array (2-3 lines describing the build).
- \`css\` (complete).
- \`html\` (streams live — keep it tidy). CDN <script> tags for Chart.js /
  D3 / etc. go inside the html.

Keep your own chat message brief (1 sentence) — the real output is the
rendered visualisation.
`;

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

type AgentState = typeof AgentStateAnnotation.State;

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({
    model: "gpt-4.1",
    modelKwargs: { parallel_tool_calls: false },
  });

  const frontendTools = convertActionsToDynamicStructuredTools(
    state.copilotkit?.actions ?? [],
  );
  const modelWithTools = model.bindTools!(frontendTools);

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node")
  .addEdge("chat_node", END);

const memory = new MemorySaver();

export const graph = workflow.compile({ checkpointer: memory });
