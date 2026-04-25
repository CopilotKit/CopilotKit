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

// `@hashbrownai/react`'s `useJsonParser(content, kit.schema)` expects the
// agent to stream a JSON object literal matching `kit.schema` — NOT the
// `<ui>...</ui>` XML-style examples shown inside `useUiKit({ examples })`.
// Those XML examples are the hashbrown prompt DSL that hashbrown compiles
// into a schema description when driving the LLM directly. Since this demo
// drives the LLM via langgraph, we mirror hashbrown's wire format — a
// `{ ui: [...] }` envelope — instead.
//
// Every node is a single-key object `{ tagName: { props: {...} } }`. Tag
// names and prop schemas match `useSalesDashboardKit()` in
// `hashbrown-renderer.tsx`. `pieChart`/`barChart` receive `data` as a
// JSON-encoded string to keep the schema stable under partial streaming.
const BYOC_HASHBROWN_SYSTEM_PROMPT = `You are a sales analytics assistant that replies by emitting a single JSON
object consumed by a streaming JSON parser on the frontend.

ALWAYS respond with a single JSON object of the form:

{
  "ui": [
    { <componentName>: { "props": { ... } } },
    ...
  ]
}

Do NOT wrap the response in code fences. Do NOT include any preface or
explanation outside the JSON object. The response MUST be valid JSON.

Available components and their prop schemas:

- "metric": { "props": { "label": string, "value": string } }
    A KPI card. \`value\` is a pre-formatted string like "$1.2M" or "248".

- "pieChart": { "props": { "title": string, "data": string } }
    A donut chart. \`data\` is a JSON-encoded STRING (embedded JSON) of an
    array of {label, value} objects with at least 3 segments, e.g.
    "data": "[{\\"label\\":\\"Enterprise\\",\\"value\\":600000}]".

- "barChart": { "props": { "title": string, "data": string } }
    A vertical bar chart. \`data\` is a JSON-encoded STRING of an array of
    {label, value} objects with at least 3 bars, typically time-ordered.

- "dealCard": { "props": { "title": string, "stage": string, "value": number } }
    A single sales deal. \`stage\` MUST be one of: "prospect", "qualified",
    "proposal", "negotiation", "closed-won", "closed-lost". \`value\` is a
    raw number (no currency symbol or comma).

- "Markdown": { "props": { "children": string } }
    Short explanatory text. Use for section headings and brief summaries.
    Standard markdown is supported in \`children\`.

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart — do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use "Markdown" for short headings or linking sentences between visual
  components. Do not emit long prose.
- Do not emit components that are not listed above.
- \`data\` props on charts MUST be a JSON STRING — escape inner quotes.

Example response (sales dashboard):
{"ui":[{"Markdown":{"props":{"children":"## Q4 Sales Summary"}}},{"metric":{"props":{"label":"Total Revenue","value":"$1.2M"}}},{"metric":{"props":{"label":"New Customers","value":"248"}}},{"pieChart":{"props":{"title":"Revenue by Segment","data":"[{\\"label\\":\\"Enterprise\\",\\"value\\":600000},{\\"label\\":\\"SMB\\",\\"value\\":400000},{\\"label\\":\\"Startup\\",\\"value\\":200000}]"}}},{"barChart":{"props":{"title":"Monthly Revenue","data":"[{\\"label\\":\\"Oct\\",\\"value\\":350000},{\\"label\\":\\"Nov\\",\\"value\\":400000},{\\"label\\":\\"Dec\\",\\"value\\":450000}]"}}}]}
`;

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

type AgentState = typeof AgentStateAnnotation.State;

async function chatNode(state: AgentState, config: RunnableConfig) {
  // Force JSON-object output mode. The frontend's `useJsonParser` bails
  // to `null` on any non-JSON prefix (code fences, prose preamble, etc.),
  // so locking the model to JSON at the API layer keeps the wire
  // contract honest. Passed via `modelKwargs` so it survives the
  // LangChain → OpenAI chat-completions mapping.
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    modelKwargs: { response_format: { type: "json_object" } },
  });
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
