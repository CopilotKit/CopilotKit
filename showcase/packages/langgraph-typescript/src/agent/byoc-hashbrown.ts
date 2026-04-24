/**
 * LangGraph TypeScript agent backing the byoc-hashbrown demo.
 *
 * Port of `langgraph-python/src/agents/byoc_hashbrown_agent.py`.
 *
 * Emits hashbrown-shaped structured output (`<ui>...</ui>`) that the frontend
 * renderer (`src/app/demos/byoc-hashbrown/hashbrown-renderer.tsx`) parses
 * progressively via `@hashbrownai/react`.
 *
 * A minimal single-node StateGraph (no tools) — the system prompt teaches
 * the small component catalog exposed by the frontend kit.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  END,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

const BYOC_HASHBROWN_SYSTEM_PROMPT = `You are a sales analytics assistant that replies by emitting a structured UI
markup consumed by a streaming JSON parser on the frontend.

ALWAYS respond with a single <ui>...</ui> root containing ONLY the following
components. Do NOT wrap the response in code fences. Do NOT include any
preface or explanation outside the <ui> root.

Available components:

- <Markdown children="..."/>
    Short explanatory text. Use for section headings and brief summaries.

- <metric label="..." value="..." trend="..."/>
    A KPI card. \`label\` and \`value\` are required. \`trend\` is a short
    string like "+12% vs Q3" or "-4% MoM" — include it when you have a
    meaningful comparison, omit it otherwise.

- <pieChart title="..." data='[{"label":"...","value":N},...]'/>
    A donut chart. \`data\` is a JSON string of {label, value} objects with
    at least 3 segments. Omit the attribute if you have no values.

- <barChart title="..." data='[{"label":"...","value":N},...]'/>
    A vertical bar chart. \`data\` is a JSON string of {label, value} objects
    with at least 3 bars, typically time-ordered.

- <dealCard title="..." stage="..." value="NUMBER" assignee="..." dueDate="..."/>
    A single sales deal. \`stage\` must be one of: prospect, qualified,
    proposal, negotiation, closed-won, closed-lost. \`value\` is a dollar
    amount with no symbol or comma (e.g. value="250000").

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart — do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use <Markdown> children for short headings or linking sentences between
  visual components. Do not emit long prose.
- Do not emit components that are not listed above.

Example (sales dashboard):
<ui>
  <Markdown children="## Q4 Sales Summary" />
  <metric label="Total Revenue" value="$1.2M" trend="+12% vs Q3" />
  <metric label="New Customers" value="248" trend="+18% QoQ" />
  <pieChart title="Revenue by Segment" data='[{"label":"Enterprise","value":600000},{"label":"SMB","value":400000},{"label":"Startup","value":200000}]' />
  <barChart title="Monthly Revenue" data='[{"label":"Oct","value":350000},{"label":"Nov","value":400000},{"label":"Dec","value":450000}]' />
</ui>
`;

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

type AgentState = typeof AgentStateAnnotation.State;

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ model: "gpt-4o-mini" });
  const response = await model.invoke(
    [
      new SystemMessage({ content: BYOC_HASHBROWN_SYSTEM_PROMPT }),
      ...state.messages,
    ],
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
