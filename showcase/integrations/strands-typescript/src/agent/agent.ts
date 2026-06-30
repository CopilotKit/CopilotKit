/**
 * Agent factories for the Strands TypeScript showcase backend.
 *
 * `buildShowcaseAgent` is the single shared agent that serves the vast
 * majority of demos (the frontend differentiates each demo via
 * useFrontendTool / useRenderTool / useHumanInTheLoop / useAgentContext).
 * It mirrors the Python sibling's `build_showcase_agent` minus A2UI.
 *
 * The tool-free specialized agents (voice, byoc-hashbrown, byoc-json-render)
 * are mounted on dedicated sub-paths by `server.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, tool } from "@strands-agents/sdk";
import { z } from "zod";
import { StrandsAgent } from "@ag-ui/aws-strands";
import type { StrandsAgentConfig } from "@ag-ui/aws-strands";
import {
  A2UI_OPERATIONS_KEY,
  createSurface,
  updateComponents,
  updateDataModel,
} from "@ag-ui/a2ui-toolkit";
import { createModel } from "./model-factory";
import { SHOWCASE_TOOLS } from "./tools";
import {
  buildStatePrompt,
  salesStateFromArgs,
  notesStateFromArgs,
  stepsStateFromArgs,
  documentStateFromArgs,
  makeSubagentStateFromResult,
} from "./state";
import {
  SYSTEM_PROMPT,
  VOICE_SYSTEM_PROMPT,
  BYOC_HASHBROWN_SYSTEM_PROMPT,
  BYOC_JSON_RENDER_SYSTEM_PROMPT,
} from "./prompts";

export async function buildShowcaseAgent(): Promise<StrandsAgent> {
  const config: StrandsAgentConfig = {
    stateContextBuilder: buildStatePrompt,
    toolBehaviors: {
      // Sales pipeline lives in shared state; emit the snapshot from args.
      manage_sales_todos: {
        skipMessagesSnapshot: true,
        stateFromArgs: salesStateFromArgs,
      },
      // Shared State (Read + Write) — notes panel.
      set_notes: { stateFromArgs: notesStateFromArgs },
      // gen-ui-agent — live progress card driven by set_steps transitions.
      set_steps: { stateFromArgs: stepsStateFromArgs },
      // shared-state-streaming — stream the document string into state.
      write_document: { stateFromArgs: documentStateFromArgs },
      // Sub-agents — append a delegation entry carrying the actual output.
      research_agent: {
        stateFromResult: makeSubagentStateFromResult("research_agent"),
      },
      writing_agent: {
        stateFromResult: makeSubagentStateFromResult("writing_agent"),
      },
      critique_agent: {
        stateFromResult: makeSubagentStateFromResult("critique_agent"),
      },
    },
  };

  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: SYSTEM_PROMPT,
    tools: SHOWCASE_TOOLS,
  });

  return new StrandsAgent({
    agent: strandsAgent,
    name: "strands_agent",
    description:
      "A polished CopilotKit demo assistant: chat, tools, shared state, HITL, sub-agents.",
    config,
  });
}

/** Tool-free agent for the voice demo (transcription + basic chat). */
export async function buildVoiceAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: VOICE_SYSTEM_PROMPT,
    tools: [],
  });
  return new StrandsAgent({
    agent: strandsAgent,
    name: "voice_agent",
    description: "Simple assistant for the voice demo — no tools.",
  });
}

/** Tool-free hashbrown UI-kit envelope generator (declarative-hashbrown). */
export async function buildByocHashbrownAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: BYOC_HASHBROWN_SYSTEM_PROMPT,
    tools: [],
  });
  return new StrandsAgent({
    agent: strandsAgent,
    name: "byoc_hashbrown",
    description:
      "Hashbrown UI-kit envelope generator for the declarative-hashbrown demo.",
  });
}

/** Tool-free json-render flat-spec generator (declarative-json-render). */
export async function buildByocJsonRenderAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: BYOC_JSON_RENDER_SYSTEM_PROMPT,
    tools: [],
  });
  return new StrandsAgent({
    agent: strandsAgent,
    name: "byoc_json_render",
    description:
      "json-render flat-spec generator for the declarative-json-render demo.",
  });
}

// ---------------------------------------------------------------------------
// A2UI Fixed Schema (declarative-generative-ui) — dedicated backend tool.
// ---------------------------------------------------------------------------
//
// Unlike the dynamic A2UI demo (which relies on the adapter auto-injecting a
// `generate_a2ui` tool to *generate* a surface), the fixed-schema demo wires a
// single plain backend tool — `display_flight` — that returns the
// `a2ui_operations` envelope (createSurface -> updateComponents ->
// updateDataModel). The component tree is fixed and authored ahead of time
// (./a2ui_schemas/flight_schema.json); only the *data* changes per call. The
// runtime A2UIMiddleware detects the envelope in the tool result and paints.
// No sub-agent, no generation, no `generate_a2ui` injection.
//
// The schema's component names + data paths must match the showcase frontend
// catalog at src/app/demos/a2ui-fixed-schema/a2ui/{definitions,renderers,
// catalog}.ts — catalog id `copilotkit://flight-fixed-catalog`. This mirrors
// the canonical langgraph-python demo (src/agents/a2ui_fixed.py).

const _A2UI_DIR = dirname(fileURLToPath(import.meta.url));

const A2UI_FIXED_CATALOG_ID = "copilotkit://flight-fixed-catalog";
const A2UI_FIXED_SURFACE_ID = "flight-fixed-schema";

// Fixed, pre-authored component layout. Loaded from JSON so it can be authored
// and reviewed independently of the agent code.
const FLIGHT_SCHEMA: Array<Record<string, unknown>> = JSON.parse(
  readFileSync(join(_A2UI_DIR, "a2ui_schemas", "flight_schema.json"), "utf-8"),
);

const A2UI_FIXED_SYSTEM_PROMPT =
  "You help users find flights. When asked about a flight, call " +
  "`display_flight` exactly ONCE with origin, destination, airline, and " +
  'price. Use short airport codes (e.g. "SFO", "JFK") for ' +
  'origin/destination and a price string like "$289". The tool\'s return ' +
  "value is an A2UI surface descriptor — the flight card is already rendered " +
  "to the user; do NOT call `display_flight` again for the same trip and do " +
  "NOT repeat the flight details in text. After the tool returns, reply with " +
  "one short confirmation sentence and stop.";

/**
 * Dedicated agent for the A2UI fixed-schema demo. Returns the envelope as a
 * plain OBJECT (not a JSON string): the Strands TS SDK wraps an object
 * tool-return in a `json` content block the adapter reads and re-stringifies
 * into the TOOL_CALL_RESULT the client A2UIMiddleware scans for
 * `a2ui_operations`. (A bare string return lands in no content block and the
 * result comes through empty — unlike the Python SDK, which wraps strings.)
 */
export async function buildA2uiFixedSchemaAgent(): Promise<StrandsAgent> {
  const displayFlight = tool({
    name: "display_flight",
    description:
      "Show a flight card for the given trip. Use short airport codes " +
      '(e.g. "SFO", "JFK") for origin/destination and a price string like ' +
      '"$289". After this tool returns, the flight card is already rendered ' +
      "to the user via the A2UI surface — do NOT call it again for the same " +
      "flight; reply with one short confirmation sentence and stop.",
    inputSchema: z.object({
      origin: z.string().describe('Origin airport code, e.g. "SFO".'),
      destination: z.string().describe('Destination airport code, e.g. "JFK".'),
      airline: z.string().describe('Airline name, e.g. "United".'),
      price: z.string().describe('Price string, e.g. "$289".'),
    }),
    callback: ({ origin, destination, airline, price }) => ({
      [A2UI_OPERATIONS_KEY]: [
        createSurface(A2UI_FIXED_SURFACE_ID, A2UI_FIXED_CATALOG_ID),
        updateComponents(A2UI_FIXED_SURFACE_ID, FLIGHT_SCHEMA),
        updateDataModel(A2UI_FIXED_SURFACE_ID, {
          origin,
          destination,
          airline,
          price,
        }),
      ],
    }),
  });

  const strandsAgent = new Agent({
    // Chat Completions API: the Responses adapter buffers tool-call argument
    // deltas, which would defeat A2UI's progressive surface streaming.
    model: await createModel({ openaiApi: "chat" }),
    systemPrompt: A2UI_FIXED_SYSTEM_PROMPT,
    tools: [displayFlight],
  });

  return new StrandsAgent({
    agent: strandsAgent,
    name: "a2ui_fixed_schema",
    description:
      "A2UI surface from a fixed, pre-authored schema (direct backend tool)",
  });
}

// ---------------------------------------------------------------------------
// A2UI Dynamic Schema (declarative-gen-ui) — adapter auto-injects generate_a2ui.
// ---------------------------------------------------------------------------
//
// Unlike the fixed-schema demo (which wires a `display_flight` tool returning a
// pre-authored envelope), the dynamic demo lets the agent *generate* the
// surface layout on the fly. The Next.js route
// (app/api/copilotkit-declarative-gen-ui/route.ts) sets
// `a2ui: { injectA2UITool: true, defaultCatalogId: "declarative-gen-ui-catalog" }`;
// the runtime forwards the flag, the Strands adapter auto-injects a
// `generate_a2ui` tool and drives a secondary render planner. The
// `config.a2ui` block below supplies the catalog id stamped into generated
// surfaces and the composition guide that teaches the planner the page's
// catalog. Mirrors the ag-ui dynamic-schema reference example.
//
// The compositionGuide MUST describe the catalog the page registers at
// src/app/demos/declarative-gen-ui/a2ui/{definitions,renderers,catalog}.ts
// (catalog id `declarative-gen-ui-catalog`): Card / StatusBadge / Metric /
// InfoRow / PrimaryButton / PieChart / BarChart / DataTable, composed inside
// the basic catalog's Row / Column / Text (`includeBasicCatalog: true`).
//
// Grounding dataset + composition rules are kept in spirit with the frontend
// `sales-context.ts` (SALES_DATASET + COMPOSITION_RULES) the page registers via
// `useAgentContext`. The frontend context steers the PRIMARY agent; this
// compositionGuide is the channel the adapter feeds to the secondary
// `render_a2ui` planner (it gets `guidelines`, not the frontend App Context),
// so the planner is self-contained.

const A2UI_DYNAMIC_CATALOG_ID = "declarative-gen-ui-catalog";

const A2UI_DYNAMIC_SALES_DATASET = `Vantage Threads (fictional B2B apparel company) — Q2 sales data. Ground every visual in these numbers; invent only plausible details consistent with them.
- Quarterly revenue: $4.2M (up 12% QoQ). New customers: 186 (up 8%). Win rate: 31% (down 2pts). Avg deal size: $22.6k (up 5%).
- Revenue by region: North America $1.9M, EMEA $1.3M, APAC $720k, LATAM $280k.
- Monthly revenue: Jan $1.21M, Feb $1.34M, Mar $1.65M, Apr $1.38M, May $1.42M, Jun $1.40M.
- Reps (vs quota): Dana Whitfield 124%, Marcus Lee 108%, Priya Sharma 97%, Tom Okafor 88%, Elena Vasquez 71%.
- At-risk: total $615k ARR across 3 accounts — Northwind Retail ($340k renewal, no contact 6 weeks; severity high), Cascadia Outfitters ($180k, champion left; severity medium), Atlas Goods ($95k, stalled legal review; severity medium).
- Biggest account: Meridian Apparel Group — owner Dana Whitfield, region North America, ARR $612k, renewal Sep 30, last contact 3 days ago, health green, 4 open opportunities worth $210k.
- Meridian revenue by product line: Outerwear $260k, Footwear $180k, Accessories $112k, Custom $60k.`;

const A2UI_DYNAMIC_COMPOSITION_RULES = `Use ONLY these exact component names (the registered catalog — any other name fails to render): Card, Column, Row, Text, Metric, PieChart, BarChart, DataTable, StatusBadge, InfoRow, PrimaryButton. The single-value KPI tile component is named exactly "Metric" (NOT "MetricTile" or "MetricCard").

Pick A2UI components by the shape of the question — never ask which chart the user wants:
1. Overall snapshot / "sales dashboard" → a Column (gap 16) whose first child is a Row (gap 16) of 4 Metric components (each with trend + trendValue), followed by a Row with a PieChart (revenue by region) next to a BarChart (monthly revenue, all six months Jan-Jun). Do NOT wrap the dashboard in a surrounding Card — the charts carry their own card chrome. Do NOT use StatusBadge, DataTable, or InfoRow here.
2. Rep / team performance → a Column (gap 16) with a Card containing a DataTable (columns: rep, attainment, pipeline) next to or above a BarChart of quota attainment % per rep — no StatusBadge or InfoRow.
3. Risk / health checks → a Column (gap 16): first a Row (gap 16) of 3 Metric components (ARR at risk $615k trend down, accounts at risk 3, biggest exposure Northwind $340k), then a Row (gap 16) with one compact Card per at-risk account (title = account name, subtitle = ARR at stake) containing a StatusBadge (error for high severity, warning otherwise) above a one-line Text with the reason and the recommended next action — no DataTable or InfoRow.
4. Single account/entity details → a Row (gap 16) with a Card of InfoRow facts (owner, region, ARR, renewal date, last contact) next to a PieChart of that account's revenue by product line — no DataTable or StatusBadge.
5. Part-of-whole follow-ups → PieChart; trends or comparisons over time/categories → BarChart.
Compose generously — a dashboard should feel like a real analytics product, not a single widget.`;

const A2UI_DYNAMIC_COMPOSITION_GUIDE = `${A2UI_DYNAMIC_SALES_DATASET}\n\n${A2UI_DYNAMIC_COMPOSITION_RULES}`;

// Mirrors the langgraph-python demo's a2ui_dynamic.py SYSTEM_PROMPT.
const A2UI_DYNAMIC_SYSTEM_PROMPT =
  "You are the embedded sales analyst for Vantage Threads, the fictional " +
  "B2B apparel company described in your App Context. Answer every " +
  "business question by calling `generate_a2ui` to draw a rich visual " +
  "surface, and keep the chat reply to one short sentence.\n\n" +
  "Ground every number in the sales dataset from App Context — never " +
  "invent figures that contradict it. Follow the dashboard composition " +
  "rules from App Context when choosing components: pick the component " +
  "by the shape of the question (snapshot → composed KPI dashboard with " +
  "charts; team performance → table; risk → status badges; single " +
  "account → info rows; part-of-whole → pie; trend/comparison → bar). " +
  "Never ask the user which chart they want. `generate_a2ui` takes no " +
  "arguments and handles the rendering automatically. Compose " +
  "generously — a dashboard should feel like a real analytics product, " +
  "not a single widget.";

/**
 * Dedicated agent for the A2UI dynamic-schema demo. Wires NO `generate_a2ui`
 * tool — the runtime's `injectA2UITool: true` makes the adapter auto-inject it
 * and drive a secondary render planner to GENERATE the surface.
 */
export async function buildA2uiDynamicAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    // Chat Completions API: the Responses adapter buffers tool-call argument
    // deltas, which would defeat A2UI's progressive surface streaming.
    model: await createModel({ openaiApi: "chat" }),
    systemPrompt: A2UI_DYNAMIC_SYSTEM_PROMPT,
  });

  const config: StrandsAgentConfig = {
    a2ui: {
      defaultCatalogId: A2UI_DYNAMIC_CATALOG_ID,
      guidelines: { compositionGuide: A2UI_DYNAMIC_COMPOSITION_GUIDE },
    },
  };

  return new StrandsAgent({
    agent: strandsAgent,
    name: "a2ui_dynamic_schema",
    description:
      "Dynamic A2UI surfaces generated on the fly (auto-injected tool)",
    config,
  });
}

// ---------------------------------------------------------------------------
// A2UI Error Recovery (a2ui-recovery) — adapter auto-injects + runs recovery.
// ---------------------------------------------------------------------------
//
// Same auto-injected dynamic-schema setup as buildA2uiDynamicAgent, but the
// aimock fixtures force the inner render_a2ui to emit free-form/sloppy args
// (heal pill) or a structurally-invalid surface on every attempt (exhaust
// pill). The Strands adapter runs the toolkit validate->retry recovery loop on
// its auto-inject path (default 3 attempts) and returns the
// a2ui_recovery_exhausted hard-fail envelope when the cap is hit — so this
// agent wires NO tool, unlike the langgraph/ADK siblings (which own the tool
// explicitly via getA2UITools + injectA2UITool:false). Mirrors the ag-ui dojo
// aws-strands recovery example.

/**
 * Dedicated agent for the A2UI error-recovery demo. Wires NO `generate_a2ui`
 * tool — the runtime's `injectA2UITool: true` makes the adapter auto-inject it,
 * drive the secondary render planner, and run the recovery loop.
 */
export async function buildA2uiRecoveryAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    // Chat Completions API: the Responses adapter buffers tool-call argument
    // deltas, which would defeat A2UI's progressive surface streaming.
    model: await createModel({ openaiApi: "chat" }),
    systemPrompt: A2UI_DYNAMIC_SYSTEM_PROMPT,
  });

  const config: StrandsAgentConfig = {
    a2ui: {
      defaultCatalogId: A2UI_DYNAMIC_CATALOG_ID,
      guidelines: { compositionGuide: A2UI_DYNAMIC_COMPOSITION_GUIDE },
    },
  };

  return new StrandsAgent({
    agent: strandsAgent,
    name: "a2ui_recovery",
    description:
      "Dynamic A2UI with automatic error recovery (auto-injected tool)",
    config,
  });
}
