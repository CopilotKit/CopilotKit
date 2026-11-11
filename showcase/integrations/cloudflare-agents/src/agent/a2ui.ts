/**
 * A2UI for the Cloudflare Agents showcase.
 *
 * - `displayFlightTool` (a2ui-fixed-schema): a plain tool whose result is the
 *   `a2ui_operations` envelope of a pre-authored surface; the runtime's
 *   A2UIMiddleware paints it.
 * - `generateA2uiTool` (declarative-gen-ui, a2ui-recovery, beautiful-chat):
 *   the backend-owned `generate_a2ui`. It runs a `render_a2ui` sub-agent (one
 *   forced tool call) and the validate→retry recovery loop from
 *   `@ag-ui/a2ui-toolkit`, and returns the operations envelope, or the
 *   `a2ui_recovery_exhausted` envelope once the attempts run out.
 *
 * `@ag-ui/cloudflare-agents` has no A2UI helper of its own (the LangGraph,
 * Strands and Mastra adapters ship a `getA2UITools`), so this file is the thin
 * AI SDK glue around the toolkit those helpers share. The routes that use it
 * set `injectA2UITool: false` or drop the middleware's `render_a2ui` client
 * tool (`withoutRenderTool`), so the model calls `generate_a2ui`.
 */
import {
  A2UI_OPERATIONS_KEY,
  GENERATE_A2UI_ARG_DESCRIPTIONS,
  GENERATE_A2UI_TOOL_DESCRIPTION,
  RENDER_A2UI_TOOL_DEF,
  buildA2UIEnvelope,
  createSurface,
  prepareA2UIRequest,
  runA2UIGenerationWithRecovery,
  splitA2UISchemaContext,
  updateComponents,
  updateDataModel,
  wrapErrorEnvelope,
} from "@ag-ui/a2ui-toolkit";
import type { A2UIGuidelines } from "@ag-ui/a2ui-toolkit";
import type { Context, Message } from "@ag-ui/client";
import { generateText, jsonSchema, tool } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { z } from "zod";
import flightSchema from "./a2ui_schemas/flight_schema.json";

const RENDER_TOOL = RENDER_A2UI_TOOL_DEF.function.name;

/** Description of the usage guide the A2UI middleware adds for its render tool. */
function renderGuideDescription(toolName: string): string {
  return `A2UI render tool usage guide — how to call ${toolName} with valid arguments.`;
}

/**
 * The client tools without the middleware's `render_a2ui`: with the
 * backend-owned `generate_a2ui` in place, the model must not call the render
 * tool directly.
 */
export function withoutRenderTool(clientTools: ToolSet): ToolSet {
  const { [RENDER_TOOL]: _render, ...rest } = clientTools;
  return rest;
}

// ---- a2ui-fixed-schema ---------------------------------------------------------

const FIXED_CATALOG_ID = "copilotkit://flight-fixed-catalog";
const FIXED_SURFACE_ID = "flight-fixed-schema";

/** `display_flight`: the fixed flight card, filled with this trip's data. */
export function displayFlightTool() {
  return tool({
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
    execute: async ({ origin, destination, airline, price }) => ({
      [A2UI_OPERATIONS_KEY]: [
        createSurface(FIXED_SURFACE_ID, FIXED_CATALOG_ID),
        updateComponents(
          FIXED_SURFACE_ID,
          flightSchema as Array<Record<string, unknown>>,
        ),
        updateDataModel(FIXED_SURFACE_ID, {
          origin,
          destination,
          airline,
          price,
        }),
      ],
    }),
  });
}

// ---- generate_a2ui ---------------------------------------------------------------

export interface GenerateA2uiOptions {
  /** The model the `render_a2ui` sub-agent calls. */
  model: () => LanguageModel;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
  /** Catalog id stamped on created surfaces (the catalog the page registers). */
  defaultCatalogId: string;
  /** Prompt knobs for the sub-agent (the catalog's composition guide). */
  guidelines?: A2UIGuidelines;
  /** The run's AG-UI context (the catalog schema the middleware adds). */
  context: Context[];
  /** The run's AG-UI messages, for updates of a surface rendered earlier. */
  messages: Message[];
  /** The thread's shared state. */
  state: Record<string, unknown>;
}

/** The sub-agent's conversation: the user and assistant text so far. */
export function subagentMessages(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("");
    if (text.trim()) out.push({ role: message.role, content: text });
  }
  return out;
}

/** Parses the toolkit's JSON envelope so the tool result is a JSON object. */
function parseEnvelope(envelope: string): unknown {
  try {
    return JSON.parse(envelope);
  } catch {
    return envelope;
  }
}

/** The backend-owned `generate_a2ui` tool. */
export function generateA2uiTool(options: GenerateA2uiOptions) {
  const [schema, regularContext] = splitA2UISchemaContext(
    options.context as unknown as Array<Record<string, unknown>>,
  );
  const renderGuide = renderGuideDescription(RENDER_TOOL);
  const state: Record<string, unknown> = {
    ...options.state,
    "ag-ui": {
      ...(schema !== undefined && { a2ui_schema: schema }),
      context: regularContext.filter(
        (entry) => entry.description !== renderGuide,
      ),
    },
  };

  return tool({
    description: GENERATE_A2UI_TOOL_DESCRIPTION,
    inputSchema: z.object({
      intent: z
        .enum(["create", "update"])
        .optional()
        .describe(GENERATE_A2UI_ARG_DESCRIPTIONS.intent),
      target_surface_id: z
        .string()
        .optional()
        .describe(GENERATE_A2UI_ARG_DESCRIPTIONS.target_surface_id),
      changes: z
        .string()
        .optional()
        .describe(GENERATE_A2UI_ARG_DESCRIPTIONS.changes),
    }),
    execute: async (input, { messages, abortSignal }) => {
      const prep = prepareA2UIRequest({
        intent: input.intent,
        targetSurfaceId: input.target_surface_id,
        changes: input.changes,
        messages: options.messages,
        state,
        guidelines: options.guidelines,
      });
      if (prep.error) return parseEnvelope(wrapErrorEnvelope(prep.error));

      const conversation = subagentMessages(messages);
      const { envelope } = await runA2UIGenerationWithRecovery({
        basePrompt: prep.prompt,
        invokeSubagent: async (prompt) => {
          const result = await generateText({
            model: options.model(),
            system: prompt,
            messages: conversation,
            tools: {
              [RENDER_TOOL]: tool({
                description: RENDER_A2UI_TOOL_DEF.function.description,
                inputSchema: jsonSchema(
                  RENDER_A2UI_TOOL_DEF.function.parameters as Parameters<
                    typeof jsonSchema
                  >[0],
                ),
              }),
            },
            toolChoice: { type: "tool", toolName: RENDER_TOOL },
            providerOptions: options.providerOptions,
            abortSignal,
          });
          const call = result.toolCalls.find((c) => c.toolName === RENDER_TOOL);
          return (call?.input as Record<string, unknown> | undefined) ?? null;
        },
        buildEnvelope: (args) =>
          buildA2UIEnvelope({
            args,
            isUpdate: prep.isUpdate,
            targetSurfaceId: input.target_surface_id,
            prior: prep.prior,
            defaultCatalogId: options.defaultCatalogId,
          }),
      });
      return parseEnvelope(envelope);
    },
  });
}

// ---- Sales dashboard catalog guide (declarative-gen-ui, a2ui-recovery) ------------

// The composition guide the render sub-agent gets for the page's
// `declarative-gen-ui-catalog`, as the Strands TypeScript sibling configures
// it: the grounding dataset plus the component rules.
export const SALES_CATALOG_ID = "declarative-gen-ui-catalog";

const SALES_DATASET = `Vantage Threads (fictional B2B apparel company) — Q2 sales data. Ground every visual in these numbers; invent only plausible details consistent with them.
- Quarterly revenue: $4.2M (up 12% QoQ). New customers: 186 (up 8%). Win rate: 31% (down 2pts). Avg deal size: $22.6k (up 5%).
- Revenue by region: North America $1.9M, EMEA $1.3M, APAC $720k, LATAM $280k.
- Monthly revenue: Jan $1.21M, Feb $1.34M, Mar $1.65M, Apr $1.38M, May $1.42M, Jun $1.40M.
- Reps (vs quota): Dana Whitfield 124%, Marcus Lee 108%, Priya Sharma 97%, Tom Okafor 88%, Elena Vasquez 71%.
- At-risk: total $615k ARR across 3 accounts — Northwind Retail ($340k renewal, no contact 6 weeks; severity high), Cascadia Outfitters ($180k, champion left; severity medium), Atlas Goods ($95k, stalled legal review; severity medium).
- Biggest account: Meridian Apparel Group — owner Dana Whitfield, region North America, ARR $612k, renewal Sep 30, last contact 3 days ago, health green, 4 open opportunities worth $210k.
- Meridian revenue by product line: Outerwear $260k, Footwear $180k, Accessories $112k, Custom $60k.`;

const SALES_COMPOSITION_RULES = `Use ONLY these exact component names (the registered catalog — any other name fails to render): Card, Column, Row, Text, Metric, PieChart, BarChart, DataTable, StatusBadge, InfoRow, PrimaryButton. The single-value KPI tile component is named exactly "Metric" (NOT "MetricTile" or "MetricCard").

Pick A2UI components by the shape of the question — never ask which chart the user wants:
1. Overall snapshot / "sales dashboard" → a Column (gap 16) whose first child is a Row (gap 16) of 4 Metric components (each with trend + trendValue), followed by a Row with a PieChart (revenue by region) next to a BarChart (monthly revenue, all six months Jan-Jun). Do NOT wrap the dashboard in a surrounding Card — the charts carry their own card chrome. Do NOT use StatusBadge, DataTable, or InfoRow here.
2. Rep / team performance → a Column (gap 16) with a Card containing a DataTable (columns: rep, attainment, pipeline) next to or above a BarChart of quota attainment % per rep — no StatusBadge or InfoRow.
3. Risk / health checks → a Column (gap 16): first a Row (gap 16) of 3 Metric components (ARR at risk $615k trend down, accounts at risk 3, biggest exposure Northwind $340k), then a Row (gap 16) with one compact Card per at-risk account (title = account name, subtitle = ARR at stake) containing a StatusBadge (error for high severity, warning otherwise) above a one-line Text with the reason and the recommended next action — no DataTable or InfoRow.
4. Single account/entity details → a Row (gap 16) with a Card of InfoRow facts (owner, region, ARR, renewal date, last contact) next to a PieChart of that account's revenue by product line — no DataTable or StatusBadge.
5. Part-of-whole follow-ups → PieChart; trends or comparisons over time/categories → BarChart.
Compose generously — a dashboard should feel like a real analytics product, not a single widget.`;

export const SALES_GUIDELINES: A2UIGuidelines = {
  compositionGuide: `${SALES_DATASET}\n\n${SALES_COMPOSITION_RULES}`,
};

/** The catalog beautiful-chat registers. */
export const DASHBOARD_CATALOG_ID = "copilotkit://app-dashboard-catalog";
