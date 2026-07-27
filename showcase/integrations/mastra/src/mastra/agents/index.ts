// Header-forwarding shim: the ag-ui/mastra adapter does not propagate
// inbound x-* headers (e.g. x-aimock-context) to the Vercel AI SDK provider.
// `@/mastra/_header_forwarding` re-exports `openai` with a fetch wrapper
// that merges ALS-bound headers into every outbound LLM call. The
// CopilotKit route is responsible for binding the per-request snapshot via
// `withForwardedHeaders(req, () => handleRequest(req))`.
import { openai } from "@/mastra/_header_forwarding";
import { Agent } from "@mastra/core/agent";
import { stepCountIs } from "ai";
import {
  weatherTool,
  stockPriceTool,
  revenueChartTool,
  queryDataTool,
  manageTodosTool,
  getTodosTool,
  scheduleMeetingTool,
  scheduleMeetingInterruptTool,
  searchFlightsTool,
  rollDiceTool,
  rollD20Tool,
  generateA2uiTool,
  setNotesTool,
  setStepsTool,
  researchAgentTool,
  writingAgentTool,
  critiqueAgentTool,
  browseWebTool,
  runDeepResearchTool,
} from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";
// Backend-owned A2UI with the toolkit validate->retry recovery loop (OSS-422).
// `@ag-ui/mastra/a2ui` is a bridge-free subpath (avoids the Mastra bundler vs
// @ag-ui/client→uuid clash); mirrors langgraph's get_a2ui_tools.
import { getA2UITools } from "@ag-ui/mastra/a2ui";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
  // Beautiful Chat's app-mode todo canvas reads `agent.state.todos`. The
  // `manage_todos` tool writes the list into working memory (see
  // writeTodosToWorkingMemory), which the bridge surfaces as a STATE_SNAPSHOT —
  // so the slice MUST be declared here or the write has nowhere to land and the
  // panel stays on "No todos yet" (OSS-452). Shape mirrors langgraph-python's
  // Todo (beautiful_chat.py) and the shared frontend's Todo interface.
  // Optional/defaulted so every other weatherAgent-backed demo is unaffected.
  todos: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        emoji: z.string(),
        status: z.enum(["pending", "completed"]),
      }),
    )
    .default([]),
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

// @region[gen-ui-agent-state-schema]
/**
 * Shared-state schema for the Gen UI Agent demo.
 *
 * `steps` is WRITTEN by the agent (via the `set_steps` tool) and READ by
 * the UI via `useAgent({ updates: [OnStateChanged] })`. Mastra includes
 * the `steps` field in its working-memory schema, so after each run-cycle
 * the AG-UI adapter emits a `STATE_SNAPSHOT` and the UI re-renders the
 * progress card.
 *
 * Status transitions: pending -> in_progress -> completed.
 */
export const GenUiAgentState = z.object({
  steps: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.enum(["pending", "in_progress", "completed"]),
      }),
    )
    .default([]),
});
// @endregion[gen-ui-agent-state-schema]

// @region[shared-state-streaming-state-schema]
/**
 * Shared-state schema for the Shared State (Streaming) demo.
 *
 * `document` is streamed token-by-token into shared state as the agent
 * writes. Mastra parity for the LangGraph `StateStreamingMiddleware` /
 * predictive-state pattern: instead of a `write_document` tool whose arg is
 * forwarded per-token, this agent calls Mastra's built-in
 * `updateWorkingMemory` tool with the growing document. The AG-UI Mastra
 * adapter intercepts that tool call's STREAMING args (OSS-414) and emits a
 * leading `STATE_SNAPSHOT` followed by incremental `STATE_DELTA`s on the
 * `document` key, so `useAgent({ updates:[OnStateChanged] })` sees
 * `state.document` grow live.
 */
export const SharedStateStreamingAgentState = z.object({
  document: z.string().default(""),
});
// @endregion[shared-state-streaming-state-schema]

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: {
    get_weather: weatherTool,
    query_data: queryDataTool,
    manage_todos: manageTodosTool,
    get_todos: getTodosTool,
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
  // Register under the snake_case names the aimock fixtures + useRenderTool
  // renderers emit (get_weather / get_stock_price / get_revenue_chart). Object
  // shorthand ({ weatherTool, stockPriceTool }) exposed the JS variable names
  // instead, so the fixture-scripted get_* tool calls were never executable and
  // the WeatherCard / StockCard / ChartCard stalled in their "running" state.
  // Mirrors gold langgraph-python headless_complete.py tools=[...].
  tools: {
    get_weather: weatherTool,
    get_stock_price: stockPriceTool,
    get_revenue_chart: revenueChartTool,
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

// @region[gen-ui-agent]
/**
 * Mastra agent backing the Gen UI Agent demo.
 *
 * Mirrors the LangGraph (python + typescript) gen-ui-agent reference: the
 * agent plans a task as 3 steps and walks each pending -> in_progress ->
 * completed, calling `set_steps` after every transition. The frontend
 * subscribes to `state.steps` via `useAgent` (v2) and renders a live
 * progress card.
 *
 * State-emission mechanism: same pattern as `sharedStateReadWriteAgent` —
 * the `set_steps` tool writes the new steps array to working memory via
 * `writeStepsToWorkingMemory`, and the AG-UI Mastra adapter emits a
 * `STATE_SNAPSHOT` after each run-cycle. The working-memory schema below
 * pins `steps` into the snapshot so the UI sees `agent.state.steps`.
 *
 * Recursion budget: the prompt drives one initial set_steps + two per step
 * (in_progress + completed) = 7 tool calls + 1 final assistant message, so
 * the Mastra agent's internal step loop sees ~8 LLM turns. Mastra's default
 * is well above that, so we don't override it here.
 */
export const genUiAgent = new Agent({
  id: "gen-ui-agent",
  name: "Gen UI Agent",
  tools: { setStepsTool },
  model: openai("gpt-4o-mini"),
  // The planner scripts 3 steps × 2 set_steps transitions (in_progress →
  // completed) + 1 initial "all pending" call + 1 closing message = ~8 model
  // turns. The AI SDK's default stop condition halts the agentic loop before
  // the 3rd step reaches "completed" (only 2/3 land), so raise the step cap to
  // run the full progression. LangGraph (gold) loops until the graph ends and
  // needs no equivalent; this is the AI-SDK step-cap analogue (cf.
  // toolRenderingAgent's d20 sequence).
  defaultOptions: {
    stopWhen: stepCountIs(12),
  },
  instructions: `You are an agentic planner. For each user request, follow this exact sequence:
1. Plan exactly 3 concrete steps and call \`set_steps\` ONCE with all three steps at status="pending".
2. Step 1: call \`set_steps\` with step 1 at status="in_progress", then call \`set_steps\` again with step 1 at status="completed".
3. Step 2: call \`set_steps\` with step 2 at status="in_progress", then call \`set_steps\` again with step 2 at status="completed".
4. Step 3: call \`set_steps\` with step 3 at status="in_progress", then call \`set_steps\` again with step 3 at status="completed".
5. Send ONE final conversational assistant message summarizing the plan, then stop. Do not call any more tools after step 3 is completed.

Rules: never call set_steps in parallel — always wait for one call to return before the next. Always pass the FULL list of steps (with their current statuses) to set_steps; never a diff. After all three steps are completed you MUST send a final assistant message and terminate.

The \`set_steps\` tool persists the steps to working memory itself — you do NOT need to also call \`updateWorkingMemory\`. Just call \`set_steps\` and the UI will update.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "gen-ui-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: GenUiAgentState,
      },
    },
  }),
});
// @endregion[gen-ui-agent]

// @region[reasoning-agent]
/**
 * Reasoning-capable model for the reasoning demos.
 *
 * Why a reasoning model (parity with langgraph-python's `reasoning_agent.py`):
 * the OpenAI Responses API streams `response.reasoning_summary_text.delta`
 * items only for native reasoning models (gpt-5, o3, o4-mini, ...). The
 * @ag-ui/mastra bridge translates those into AG-UI REASONING_MESSAGE_* events
 * (`role: "reasoning"`), which the frontend renders via the built-in
 * `CopilotChatReasoningMessage` (reasoning-default) or a custom
 * `reasoningMessage` slot (reasoning-custom). gpt-4o / gpt-4o-mini emit no
 * reasoning items, so mapping these demos to the default weatherAgent (gpt-4o)
 * meant the reasoning slot never lit up. Override via `OPENAI_REASONING_MODEL`.
 */
export const REASONING_MODEL =
  process.env.OPENAI_REASONING_MODEL ?? "gpt-5-mini";

/**
 * Provider options that force the OpenAI Responses API to emit a reasoning
 * summary on every turn. `summary: "detailed"` is what makes the model stream
 * its chain of thought as `reasoning_summary_text.delta` items (mirrors the
 * gold `reasoning={"effort":"medium","summary":"detailed"}` config). Passed as
 * the agent's default `.stream()` options so the @ag-ui/mastra bridge (which
 * calls `agent.stream()`) picks them up on every run.
 */
const REASONING_PROVIDER_OPTIONS = {
  openai: {
    reasoningEffort: "medium",
    reasoningSummary: "detailed",
  },
} as const;

/**
 * Mastra agent backing the Reasoning: Default and Reasoning: Custom demos.
 *
 * Shared by both cells (the only difference is frontend-side: whether the
 * `messageView.reasoningMessage` slot is overridden). No tools — these demos
 * exercise pure reasoning-summary streaming, matching gold's `reasoning_agent`.
 */
export const reasoningAgent = new Agent({
  id: "reasoning-agent",
  name: "Reasoning Agent",
  tools: {},
  model: openai(REASONING_MODEL),
  defaultOptions: {
    providerOptions: REASONING_PROVIDER_OPTIONS,
  },
  instructions: `You are a helpful assistant. Think through problems step by step before answering. When a question benefits from reasoning, work through the intermediate steps, then give a clear, concise final answer.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "reasoning-agent-memory",
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
// @endregion[reasoning-agent]

// @region[reasoning-chain-agent]
/**
 * Mastra agent backing the Tool Rendering + Reasoning Chain demo.
 *
 * Combines reasoning-summary streaming (same reasoning model + provider
 * options as `reasoningAgent`) with backend tool rendering. Registers the
 * four chain tools the aimock fixtures script (weather, flights, stock,
 * dice) under the exact tool-call names the fixtures emit (`get_weather`,
 * `search_flights`, `get_stock_price`, `roll_dice`) so Mastra can EXECUTE
 * each leg and advance the multi-turn chain to its final narration. Mapping
 * this demo to the default weatherAgent left `get_stock_price`/`roll_dice`
 * unregistered, so the stock/dice chains never reached the closing message.
 *
 * Mirrors langgraph-python's `tool_rendering_reasoning_chain_agent.py`
 * (system prompt + toolset + reasoning model).
 */
export const reasoningChainAgent = new Agent({
  id: "reasoning-chain-agent",
  name: "Reasoning Chain Agent",
  tools: {
    get_weather: weatherTool,
    search_flights: searchFlightsTool,
    get_stock_price: stockPriceTool,
    roll_dice: rollDiceTool,
  },
  model: openai(REASONING_MODEL),
  defaultOptions: {
    providerOptions: REASONING_PROVIDER_OPTIONS,
  },
  instructions: `You are a helpful travel & lifestyle concierge with mock tools for weather, flights, stock prices, and dice rolls — they all return mock data, so always call them rather than guessing.

Your habit is to CHAIN tools when one answer naturally invites another. For a single user question, call at least TWO tools in sequence when it makes sense:
  - "What's the weather in <city>?" -> call get_weather(<city>), then call search_flights(origin='SFO', destination=<city>) so the user can act on it.
  - "How is <ticker> doing?" -> call get_stock_price(<ticker>), then call get_stock_price on a comparable ticker (e.g. 'MSFT' or 'AAPL') to compare.
  - "Roll a 20-sided die" -> call roll_dice(sides=20), then call roll_dice again with a different number of sides so the user sees a contrast.
  - "Find flights from <a> to <b>" -> call search_flights(a, b), then call get_weather(<b>) for the destination.

Only skip the second tool call when the question is truly atomic and more tool calls would feel intrusive. Never fabricate data that a tool could provide. After the tools return, write one short narration summarizing the results.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "reasoning-chain-agent-memory",
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
// @endregion[reasoning-chain-agent]

// @region[tool-rendering-agent]
/**
 * Dedicated agent for the tool-rendering demos (tool-rendering,
 * tool-rendering-default-catchall, tool-rendering-custom-catchall). Binds all
 * four demo tools under the exact names the aimock fixtures emit — get_weather,
 * search_flights, get_stock_price, roll_d20 — so Mastra can EXECUTE each pill's
 * tool call and the card renders. Routing this demo to the default weatherAgent
 * left get_stock_price / roll_d20 unregistered, so the Stock, d20, and Chain
 * pills emitted uncallable tool calls that the AI SDK dropped (no card).
 *
 * Mirrors langgraph-python's tool_rendering_agent.py (system prompt + toolset).
 */
export const toolRenderingAgent = new Agent({
  id: "tool-rendering-agent",
  name: "Tool Rendering Agent",
  tools: {
    get_weather: weatherTool,
    search_flights: searchFlightsTool,
    get_stock_price: stockPriceTool,
    roll_d20: rollD20Tool,
  },
  model: openai("gpt-4o"),
  // The "Roll a d20" pill chains 5 sequential roll_d20 calls + a closing
  // narration (6 model turns), and "Chain tools" fans out 3 tools then
  // summarizes. The AI SDK default stop condition halts the agentic loop
  // before the sequence completes (only 4/5 dice cards render), so raise the
  // step cap enough to run the longest scripted chain to completion.
  defaultOptions: {
    stopWhen: stepCountIs(8),
  },
  instructions: `You are a travel & lifestyle concierge. Use the mock tools for weather, flights, stock prices, or d20 rolls when the user asks; otherwise reply in plain text. For flights, default origin to 'SFO' if the user only names a destination. Call multiple tools in one turn if asked. After tools return, summarize in one short sentence. Never fabricate data a tool could provide.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "tool-rendering-agent-memory",
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
// @endregion[tool-rendering-agent]

// @region[shared-state-streaming-agent]
/**
 * Mastra agent backing the Shared State (Streaming) demo.
 *
 * Per-token state streaming. When asked to write, draft, or revise text the
 * agent calls the built-in `updateWorkingMemory` tool with the FULL document
 * text under the `document` key. Because working memory is enabled with the
 * `SharedStateStreamingAgentState` schema, Mastra streams that tool call's
 * args as `tool-call-delta` frames; the AG-UI Mastra adapter accumulates
 * them, re-parses the growing prefix, and emits a leading `STATE_SNAPSHOT`
 * plus incremental `STATE_DELTA`s on `/document` (OSS-414). The frontend
 * renders `state.document` live as it fills in.
 *
 * NOTE: unlike `sharedStateReadWriteAgent`/`genUiAgent` (which use a custom
 * `set_*` tool that yields a single end-of-run `STATE_SNAPSHOT`), this demo
 * deliberately drives the built-in `updateWorkingMemory` tool — that is the
 * only path that streams progressive per-token deltas rather than one blob
 * at run end. So the prompt tells the model to write the document straight
 * into working memory instead of via a bespoke tool.
 */
export const sharedStateStreamingAgent = new Agent({
  id: "shared-state-streaming",
  name: "Shared State Streaming Agent",
  tools: {},
  model: openai("gpt-4o"),
  instructions: `You are a collaborative writing assistant wired to a live Document panel.

Whenever the user asks you to write, draft, revise, or explain anything of any length (a poem, an email, an essay, a summary, an explanation, etc.), you MUST call the \`updateWorkingMemory\` tool with the FULL content as a single string under the \`document\` field, e.g. { "document": "<the full text>" }.

Rules:
  - NEVER paste the document body into a chat message. The document belongs in shared state — the UI renders it live from working memory as you stream it.
  - Always send the ENTIRE document in one \`updateWorkingMemory\` call (not a diff, not chunks across multiple calls).
  - After the document is written, reply with ONE short chat sentence confirming what you wrote (e.g. "Done — I've drafted your poem in the document panel."). Keep the document text itself out of that message.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "shared-state-streaming-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: SharedStateStreamingAgentState,
      },
    },
  }),
});
// @endregion[shared-state-streaming-agent]

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
// @region[backend-interrupt-tool]
// @region[interrupt-agent]
/**
 * Scheduling agent for the interrupt-adapted demos (gen-ui-interrupt,
 * interrupt-headless).
 *
 * This agent powers the NATIVE interrupt path (OSS-383). The backend
 * `schedule_meeting` tool `suspend()`s with a time-picker payload; the
 * @ag-ui/mastra v1 bridge maps that to an AG-UI interrupt (legacy
 * `on_interrupt` CUSTOM event + the standard `RUN_FINISHED` interrupt-outcome,
 * on by default). The frontend `useInterrupt` (gen-ui-interrupt, in-chat) /
 * hand-rolled headless subscription (interrupt-headless, app-surface) renders
 * the picker and resolves it, which resumes the run — re-invoking the tool's
 * `execute` with `resumeData`. Replaces the prior `useHumanInTheLoop`
 * frontend-tool workaround.
 *
 * Resume requires instance `storage` (see src/mastra/index.ts) so the
 * suspended agentic-loop snapshot can be reloaded.
 */
export const interruptAgent = new Agent({
  id: "interrupt-agent",
  name: "Interrupt Agent",
  tools: { schedule_meeting: scheduleMeetingInterruptTool },
  model: openai("gpt-4o-mini"),
  instructions: `You are a scheduling assistant. Whenever the user asks you to book a call or schedule a meeting, you MUST call the \`schedule_meeting\` tool. Pass a short \`topic\` describing the purpose of the meeting and, if known, an \`attendee\` describing who the meeting is with.

The \`schedule_meeting\` tool surfaces an interactive time-picker to the user and pauses until they pick a slot (or cancel), then returns their selection to you. After it returns, briefly confirm whether the meeting was scheduled and at what time, or note that the user cancelled. Do NOT ask for approval yourself — always call the tool and let the picker handle the decision.

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
// @endregion[backend-interrupt-tool]

// A2UI Error Recovery agent (OSS-422). Backend-owned `generate_a2ui` via
// getA2UITools, which runs the forced render_a2ui subagent + the toolkit
// validate->retry recovery loop + the recovery-exhausted hard-fail envelope
// INSIDE the tool. The dedicated route (/api/copilotkit-a2ui-recovery) sets
// a2ui.injectA2UITool=false so the runtime does not inject a second copy.
// Reuses the declarative-gen-ui catalog ("declarative-gen-ui-catalog"); mirrors
// langgraph-python recovery_agent.py + the strands recovery cell.
export const a2uiRecoveryAgent = new Agent({
  id: "a2ui-recovery",
  name: "A2UI Recovery Agent",
  model: openai("gpt-4.1"),
  instructions:
    "You are the embedded sales analyst for Vantage Threads, a fictional B2B " +
    "apparel company. Answer every business question by calling `generate_a2ui` " +
    "to draw a rich visual surface, and keep the chat reply to one short " +
    "sentence. `generate_a2ui` handles the rendering — and its automatic " +
    "recovery — for you.",
  tools: {
    generate_a2ui: getA2UITools({
      model: openai("gpt-4.1"),
      defaultCatalogId: "declarative-gen-ui-catalog",
      recovery: { maxAttempts: 3 },
    }),
  },
  memory: new Memory({
    storage: new LibSQLStore({
      id: "a2ui-recovery-memory",
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

// @region[browser-use-agent]
/**
 * Mastra agent backing the Browser Use demo (OSS-91).
 *
 * Modeled on Mastra's HackerNews browser example: the agent drives a real,
 * LOCAL headless browser (Playwright Chromium — no hosted-browser API key)
 * via the `browse_web` tool, then summarizes what it found back into the
 * CopilotKit chat. The frontend renders the structured results as cards via
 * a custom `useRenderTool` renderer.
 *
 * This is a Mastra-only, real-LLM demo: browser navigation is
 * non-deterministic (live pages change every request) and therefore does
 * NOT replay under aimock. There is no D6 aimock fixture for this cell — see
 * `qa/browser-use.md` and `tests/e2e/browser-use.spec.ts` for the rationale.
 *
 * Failure handling lives in the tool: `browse_web` returns a structured
 * `{ error }` payload if the local Chromium binary is missing or a launch
 * fails, so the run always completes rather than crashing.
 */
export const browserUseAgent = new Agent({
  id: "browser-use-agent",
  name: "Browser Use Agent",
  tools: { browse_web: browseWebTool },
  model: openai("gpt-4o-mini"),
  instructions: `You are a web-browsing assistant with access to a REAL local browser via the \`browse_web\` tool.

When the user asks you to look something up on the web, read a page, or check what's trending:
1. Call \`browse_web\` with a clear \`task\` describing what to fetch. Pass an explicit http(s) URL when the user names a site (e.g. "read https://www.copilotkit.ai"); otherwise describe the goal (e.g. "top Hacker News stories").
2. The tool returns JSON with a \`results\` array (and, for page reads, a \`text\` excerpt). Base your answer ONLY on what the tool returns — never invent stories, links, scores, or page contents.
3. Write a short, useful summary in chat: for Hacker News, mention a few of the top stories with their points; for a page read, summarize what the page is about in 2-3 sentences.

If the tool returns an \`error\` field, tell the user plainly that the browser could not run and relay the error message (it usually means the local Chromium binary is not installed). Do not retry more than once.

Keep responses concise and always end with a brief final assistant message so the summary persists.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "browser-use-agent-memory",
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
// @endregion[browser-use-agent]

// @region[background-agents-agent]
/**
 * Background Agents demo agent (OSS-426).
 *
 * Wires the backgroundable `run_deep_research` tool. When the user asks to
 * research a topic, the agent calls the tool once; Mastra dispatches it as a
 * background task (the instance enables the BackgroundTaskManager in
 * `src/mastra/index.ts`) and MastraAgent surfaces it as a live "working"
 * activity card instead of a normal tool pill. Completion is out of band —
 * see `src/mastra/tools/background-research.ts`.
 */
export const backgroundAgentsAgent = new Agent({
  id: "background-agents",
  name: "Background Agents Agent",
  tools: { runDeepResearchTool },
  model: openai("gpt-4.1"),
  instructions: `You are a research assistant that dispatches long-running work to the background.

When the user asks you to research, investigate, look into, or dig into a topic, you MUST call the \`run_deep_research\` tool ONCE with a concise \`topic\` describing what to research. That kicks the work off in the background so the conversation can continue.

After you call the tool, send ONE short assistant message telling the user the deep-research task is now running in the background and that you'll surface the findings when it completes. Do not call the tool more than once per request, and do not wait for results before replying.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "background-agents-agent-memory",
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
// @endregion[background-agents-agent]

// @region[observational-memory-agent]
/**
 * Mastra agent backing the Observational Memory demo (OSS-427).
 *
 * Observational Memory (OM) is a Mastra `Memory` feature: as the conversation
 * grows, Mastra runs an Observer agent OUT OF BAND that reads the unobserved
 * messages, compresses them into structured observations, and activates those
 * observations into the working context. OM surfaces this background work on
 * the agent's `fullStream` as typed `data-om-*` chunks, which MastraAgent maps
 * to AG-UI activity events (activityType `mastra-observational-memory`).
 *
 * TWO independent opt-ins: (1) HERE — enable OM on the agent's `Memory` via
 * `options.observationalMemory`; (2) in the route — the surfacing toggle
 * `getLocalAgents({ mastra, observationalMemory: true })`.
 *
 * Config notes (verified vs @mastra/memory 1.22): `scope:'thread'` is required
 * for the async buffering path (`'resource'` throws); the trigger is UNOBSERVED
 * message-token SIZE (not turn count) with a reliable 600/300 floor (200/100
 * no-ops) — the demo pills send SIZABLE messages to trip it; a config object
 * requires an explicit model (default google/gemini-2.5-flash), pinned to the
 * forwarding `openai` so the Observer call routes through the header shim.
 */
export const observationalMemoryAgent = new Agent({
  id: "observational-memory-agent",
  name: "Observational Memory Agent",
  model: openai("gpt-4.1"),
  instructions: `You are a helpful assistant with a long memory. The user will share large amounts of context about their work, projects, and preferences across the conversation. Read what they share carefully, answer their questions directly and concisely, and lean on everything they've told you so far. Keep replies focused — a few short paragraphs at most.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "observational-memory-agent-memory",
      url: WORKING_MEMORY_DB_URL,
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
      observationalMemory: {
        scope: "thread",
        observation: { messageTokens: 600, bufferTokens: 300 },
        model: openai("gpt-4.1"),
      },
    },
  }),
});
// @endregion[observational-memory-agent]
