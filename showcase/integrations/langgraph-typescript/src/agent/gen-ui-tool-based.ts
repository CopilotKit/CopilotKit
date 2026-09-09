/**
 * Tool-Based Generative UI agent — TypeScript port of gen_ui_tool_based.py.
 *
 * The frontend registers `render_bar_chart` and `render_pie_chart` via
 * `useComponent`. CopilotKit's LangGraph middleware forwards those as actions
 * on `state.copilotkit.actions`; we bind them so the model can call them.
 *
 * There are no backend tools — the chart components are rendered on the
 * frontend — so the graph ends after the model turn (no tool_node).
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import {
  Annotation,
  MemorySaver,
  START,
  StateGraph,
  messagesStateReducer,
  BaseMessage,
} from "@langchain/langgraph";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";
import { makeChatOpenAI } from "./openai-headers";

const SYSTEM_PROMPT = `You are a data visualization assistant.

When the user asks for a chart, call \`render_bar_chart\` or \`render_pie_chart\`
with a concise title, short description, and a \`data\` array of
\`{label, value}\` items. Pick bar for comparisons over a small set of
categories; pick pie for composition / share-of-whole.

If the user names a chart subject but does NOT supply concrete numbers
(e.g. "show me a pie chart of website traffic by source"), do NOT ask
them for data. Invent plausible illustrative sample values yourself,
call the appropriate \`render_*\` tool immediately, and briefly note in
the follow-up that the values are illustrative samples. Always render
the chart on the first turn -- never reply with a clarifying question
asking for the data.

Keep chat responses brief -- let the chart do the talking.`;

// Define `messages` explicitly (concrete channel type) rather than relying on
// the spread of `CopilotKitStateAnnotation.spec` alone — the langgraph-api
// schema pre-warmer skips graphs whose state exposes no concrete channel, so
// this graph must carry an explicit `messages` annotation like every other
// registering graph in this package.
const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

type AgentState = typeof AgentStateAnnotation.State;

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = makeChatOpenAI(config, { temperature: 0, model: "gpt-4o" });

  const modelWithTools = model.bindTools!(
    convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
  );

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node");

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
