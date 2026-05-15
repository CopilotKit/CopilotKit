import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import {
  weatherTool,
  stockPriceTool,
  queryDataTool,
  manageSalesTodosTool,
  getSalesTodosTool,
  scheduleMeetingTool,
  searchFlightsTool,
  generateA2uiTool,
  setNotesTool,
  researchAgentTool,
  writingAgentTool,
  critiqueAgentTool,
} from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

/**
 * Persistent SQLite URL for working-memory storage.
 *
 * Why not `file::memory:`: an in-memory store resets on every process
 * restart. For demos that surface user state to the UI (notes panel, agent
 * delegations, preferences), that is silent data loss — the user adds notes,
 * the dev hits save, Next.js HMR restarts the server, and the notes vanish
 * with no error.
 *
 * Tests can override via `MASTRA_WORKING_MEMORY_URL=file::memory:` to keep
 * fixture isolation. The default is a relative file path so the DB lives
 * next to the package and survives reloads.
 */
export const WORKING_MEMORY_DB_URL =
  process.env.MASTRA_WORKING_MEMORY_URL ?? "file:./mastra-memory.db";

// @region[shared-state-rw-state-schema]
/**
 * Shared-state schema for the Shared State (Read + Write) demo.
 *
 * - `preferences` is WRITTEN by the UI via `agent.setState({ preferences })`.
 *   The AG-UI Mastra adapter merges `input.state` into the thread's
 *   `workingMemory` metadata before each run, so the LLM sees the latest UI
 *   preferences as part of working memory on every turn.
 * - `notes` is WRITTEN by the agent (via the `set_notes` tool) and READ by
 *   the UI via `useAgent({ updates: [OnStateChanged] })`. Mastra emits a
 *   `STATE_SNAPSHOT` after each run with the working-memory contents.
 */
export const SharedStateRWAgentState = z.object({
  preferences: z
    .object({
      name: z.string().default(""),
      tone: z.enum(["formal", "casual", "playful"]).default("casual"),
      language: z.string().default("English"),
      interests: z.array(z.string()).default([]),
    })
    .default({
      name: "",
      tone: "casual",
      language: "English",
      interests: [],
    }),
  notes: z.array(z.string()).default([]),
});
// @endregion[shared-state-rw-state-schema]

// @region[subagents-state-schema]
/**
 * Shared-state schema for the Sub-Agents demo.
 *
 * `delegations` is appended to by the supervisor as it fans out work to the
 * research / writing / critique sub-agents. The UI subscribes via
 * `useAgent({ updates: [OnStateChanged] })` and renders a live delegation
 * log.
 */
export const SubagentsAgentState = z.object({
  delegations: z
    .array(
      z.object({
        id: z.string(),
        sub_agent: z.enum([
          "research_agent",
          "writing_agent",
          "critique_agent",
        ]),
        task: z.string(),
        status: z.enum(["running", "completed", "failed"]),
        result: z.string(),
      }),
    )
    .default([]),
});
// @endregion[subagents-state-schema]

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: {
    get_weather: weatherTool,
    query_data: queryDataTool,
    manage_sales_todos: manageSalesTodosTool,
    get_sales_todos: getSalesTodosTool,
    schedule_meeting: scheduleMeetingTool,
    search_flights: searchFlightsTool,
    generate_a2ui: generateA2uiTool,
  },
  model: openai("gpt-4o"),
  instructions: "You are a helpful assistant.",
  memory: new Memory({
    storage: new LibSQLStore({
      id: "weather-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});

// Dedicated agent for the headless-complete demo. Exercises the full
// generative-UI stack when the chat UI is composed manually: two backend
// tools (weather + stock price) wired through `useRenderTool`, plus a
// frontend-registered `highlight_note` tool the agent can invoke via the
// same tool-call channel. The system prompt nudges the model toward the
// right surface per user question and falls back to plain text otherwise.
//
// Note: `highlight_note` is intentionally NOT declared here — it's a
// frontend-only tool registered via `useComponent` in the demo's
// `tool-renderers.tsx`. The agent picks it up through CopilotKit's
// frontend-tool forwarding when `copilotkit.runAgent` is called.
export const headlessCompleteAgent = new Agent({
  id: "headless-complete-agent",
  name: "Headless Complete Agent",
  tools: {
    weatherTool,
    stockPriceTool,
  },
  model: openai("gpt-4o-mini"),
  instructions: `You are a helpful, concise assistant wired into a headless chat surface that demonstrates CopilotKit's full rendering stack. Pick the right surface for each user question and fall back to plain text when none of the tools fit.

Routing rules:
  - If the user asks about weather for a place, call \`get_weather\` with the location.
  - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...), call \`get_stock_price\` with the ticker.
  - If the user asks you to highlight, flag, or mark a short note or phrase, call the frontend \`highlight_note\` tool with the text and a color (yellow, pink, green, or blue). Do NOT ask the user for the color — pick a sensible one if they didn't say.
  - Otherwise, reply in plain text.

After a tool returns, write one short sentence summarizing the result. Never fabricate data a tool could provide.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "headless-complete-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});

// @region[shared-state-rw-agent]
/**
 * Mastra agent backing the Shared State (Read + Write) demo.
 *
 * Bidirectional shared-state pattern:
 *   - UI -> agent: the UI writes `preferences` via `agent.setState(...)`.
 *     The AG-UI Mastra adapter merges that into working memory before each
 *     run, so the LLM reads it as part of its system context.
 *   - agent -> UI: the LLM calls `set_notes` to update the `notes` array.
 *     Mastra includes the `notes` field in its working-memory schema, so
 *     after each run the AG-UI adapter emits a `STATE_SNAPSHOT` and the UI
 *     re-renders.
 *
 * Note on the system prompt: rather than a static string, this is a
 * function so we can reaffirm — every turn — that the LLM should respect
 * whatever `preferences` are sitting in working memory. Mastra exposes
 * working memory to the LLM automatically; the prompt just nudges it to
 * actually USE those preferences instead of ignoring them.
 */
export const sharedStateReadWriteAgent = new Agent({
  id: "shared-state-read-write",
  name: "Shared State Read+Write Agent",
  tools: { setNotesTool },
  model: openai("gpt-4o-mini"),
  instructions: `You are a helpful, concise assistant wired to a UI that owns the user's preferences and an agent-authored notes panel.

PREFERENCES (READ from working memory every turn):
The UI writes a \`preferences\` object into shared state. It contains:
  - name: how to address the user
  - tone: "formal" | "casual" | "playful"
  - language: the language to reply in
  - interests: a list of topics the user cares about
Always tailor your reply to these preferences. Address the user by name when one is set. Reply in their preferred language and tone. Lean on their interests when suggesting examples or topics.

NOTES (WRITE via the \`set_notes\` tool):
The UI also renders an "Agent notes" panel sourced from the \`notes\` array in shared state. Whenever the user asks you to remember something, OR when you make a useful observation about the user worth surfacing, call the \`set_notes\` tool with the FULL updated list of short note strings (existing notes + new ones). Always pass the entire list — never a diff. Keep each note short (< 120 chars).

The \`set_notes\` tool persists the notes to working memory itself — you do NOT need to also call \`updateWorkingMemory\`. Just call \`set_notes\` and the UI will update.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "shared-state-rw-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: SharedStateRWAgentState,
      },
    },
  }),
});
// @endregion[shared-state-rw-agent]

// @region[subagents-supervisor]
/**
 * Mastra agent backing the Sub-Agents demo.
 *
 * Supervisor pattern: this agent delegates to three specialized sub-agents
 * (research / writing / critique) exposed as tools. Each tool runs the
 * matching sub-agent under the hood and returns both its output and a
 * `delegation` entry the supervisor must append to working memory's
 * `delegations` array. The UI renders that array live as a delegation log.
 *
 * Sub-agents are defined alongside the tools in
 * `src/mastra/tools/subagents.ts` — they're full `Agent` instances with
 * their own system prompts and don't share memory with the supervisor.
 */
export const subagentsSupervisorAgent = new Agent({
  id: "subagents-supervisor",
  name: "Subagents Supervisor",
  tools: {
    researchAgentTool,
    writingAgentTool,
    critiqueAgentTool,
  },
  model: openai("gpt-4o-mini"),
  instructions: `You are a supervisor agent that coordinates three specialized sub-agents to produce high-quality deliverables.

Available sub-agents (call them as tools):
  - research_agent: gathers facts on a topic.
  - writing_agent: turns facts + a brief into a polished draft.
  - critique_agent: reviews a draft and suggests improvements.

For most non-trivial user requests, delegate in sequence: research -> write -> critique. Pass the relevant facts/draft through the \`task\` argument of each tool. Keep your own messages short — explain the plan once, delegate, then return a concise summary once done.

DELEGATION LOG (working memory):
Each sub-agent tool returns a JSON payload of the form \`{ "result": <text>, "delegation": <Delegation> }\`. The tool itself appends the \`delegation\` object to the \`delegations\` array in working memory — you do NOT need to call \`updateWorkingMemory\` for delegations. Just keep delegating; the live log updates automatically.

If a delegation's \`status\` field is \`"failed"\`, treat it as a real error: do not pretend the sub-agent succeeded. Decide whether to retry, fall back to a different sub-agent, or summarize the failure to the user.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "subagents-supervisor-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: SubagentsAgentState,
      },
    },
  }),
});
// @endregion[subagents-supervisor]

/**
 * Lightweight Mastra agent backing the MCP Apps demo.
 *
 * Defines no bespoke tools — the CopilotKit runtime is wired with
 * `mcpApps: { servers: [...] }` (see
 * `src/app/api/copilotkit-mcp-apps/route.ts`). The runtime auto-applies the
 * MCP Apps middleware, which injects the remote MCP server's tools into
 * each request and emits the activity events the built-in
 * `MCPAppsActivityRenderer` renders in chat as sandboxed iframes.
 */
export const mcpAppsAgent = new Agent({
  id: "mcp-apps-agent",
  name: "MCP Apps Agent",
  model: openai("gpt-4o-mini"),
  instructions: `You draw simple diagrams in Excalidraw via the MCP tool.

SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize for polish. Target: one tool call, done in seconds.

When the user asks for a diagram:
1. Call \`create_view\` ONCE with 3-5 elements total: shapes + arrows + an optional title text.
2. Use straightforward shapes (rectangle, ellipse, diamond) with plain \`label\` fields (\`{"text": "...", "fontSize": 18}\`) on them.
3. Connect with arrows. Endpoints can be element centers or simple coordinates.
4. Include ONE \`cameraUpdate\` at the END of the elements array that frames the whole diagram (600x450 or 800x600).
5. Reply with ONE short sentence describing what you drew.

Every element needs a unique string \`id\` (e.g. \`"b1"\`, \`"a1"\`, \`"title"\`). Standard sizes: rectangles 160x70, ellipses/diamonds 120x80, 40-80px gap between shapes.

Do NOT call \`read_me\`, do NOT iterate, do NOT make multiple calls. Ship on the first shot.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "mcp-apps-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});

// @region[byoc-hashbrown-agent]
/**
 * Mastra agent backing the byoc-hashbrown demo.
 *
 * The demo page wraps CopilotChat in the HashBrownDashboard provider and
 * overrides the assistant message slot with a renderer that consumes
 * hashbrown-shaped structured output via `@hashbrownai/react`'s `useUiKit`
 * + `useJsonParser`.
 *
 * The system prompt forces the model to emit a single JSON envelope
 * `{ "ui": [ { <componentName>: { "props": { ... } } }, ... ] }` matching
 * the schema consumed by `useSalesDashboardKit()` in the frontend renderer.
 * Without this prompt the default weatherAgent produces plain text, which
 * `useJsonParser` parses as `null` and the dashboard renders nothing.
 */
export const byocHashbrownAgent = new Agent({
  id: "byoc-hashbrown-agent",
  name: "BYOC Hashbrown Agent",
  model: openai("gpt-4o-mini"),
  instructions: `You are a sales analytics assistant that replies by emitting a single JSON
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
{"ui":[{"Markdown":{"props":{"children":"## Q4 Sales Summary"}}},{"metric":{"props":{"label":"Total Revenue","value":"$1.2M"}}},{"metric":{"props":{"label":"New Customers","value":"248"}}},{"pieChart":{"props":{"title":"Revenue by Segment","data":"[{\\"label\\":\\"Enterprise\\",\\"value\\":600000},{\\"label\\":\\"SMB\\",\\"value\\":400000},{\\"label\\":\\"Startup\\",\\"value\\":200000}]"}}},{"barChart":{"props":{"title":"Monthly Revenue","data":"[{\\"label\\":\\"Oct\\",\\"value\\":350000},{\\"label\\":\\"Nov\\",\\"value\\":400000},{\\"label\\":\\"Dec\\",\\"value\\":450000}]"}}}]}`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "byoc-hashbrown-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});
// @endregion[byoc-hashbrown-agent]

/**
 * Vision-capable Mastra agent backing the Multimodal Attachments demo.
 *
 * gpt-4o supports image and PDF attachments in the messages array. The
 * AG-UI Mastra adapter forwards user-message `content` parts (image_url /
 * file) verbatim to the model. Kept on a dedicated agent (and dedicated
 * route) so the vision-tier cost is scoped to exactly the cell that
 * exercises it.
 */
// @region[interrupt-agent]
/**
 * Scheduling agent for the interrupt-adapted demos (gen-ui-interrupt,
 * interrupt-headless).
 *
 * This agent powers the "Strategy B" adaptation of the LangGraph interrupt
 * demos. LangGraph has a native `interrupt()` primitive with
 * checkpoint/resume; Mastra does not. Instead, we register a frontend tool
 * (`schedule_meeting`) via `useFrontendTool` with an async handler. The
 * handler returns a Promise that only resolves once the user picks a time
 * slot (or cancels), producing the same UX as `interrupt()`.
 *
 * The agent defines NO backend tools — `schedule_meeting` is satisfied
 * entirely by the frontend. The system prompt directs the model to always
 * call `schedule_meeting` when asked to book/schedule.
 */
export const interruptAgent = new Agent({
  id: "interrupt-agent",
  name: "Interrupt Agent",
  tools: {},
  model: openai("gpt-4o-mini"),
  instructions: `You are a scheduling assistant. Whenever the user asks you to book a call or schedule a meeting, you MUST call the \`schedule_meeting\` tool. Pass a short \`topic\` describing the purpose of the meeting and, if known, an \`attendee\` describing who the meeting is with.

The \`schedule_meeting\` tool is implemented on the client: it surfaces a time-picker UI to the user and returns the user's selection. After the tool returns, briefly confirm whether the meeting was scheduled and at what time, or note that the user cancelled. Do NOT ask for approval yourself — always call the tool and let the picker handle the decision.

Keep responses short and friendly. After you finish executing tools, always send a brief final assistant message summarizing what happened so the message persists.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "interrupt-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});
// @endregion[interrupt-agent]

export const multimodalAgent = new Agent({
  id: "multimodal-demo",
  name: "Multimodal Agent",
  model: openai("gpt-4o"),
  instructions:
    "You are a helpful assistant with vision and document capabilities. When the user shares an image or PDF, examine it carefully and answer their question about it. Be concise and specific — describe what you actually see, not what you guess might be there.",
  memory: new Memory({
    storage: new LibSQLStore({
      id: "multimodal-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});
