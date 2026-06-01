import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";

const CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog";
const A2UI_OPERATIONS_KEY = "a2ui_operations";
const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const SYSTEM_PROMPT = `You are a demo assistant for Declarative Generative UI \
(A2UI — Dynamic Schema). Whenever a response would benefit from a rich \
visual — a dashboard, status report, KPI summary, card layout, info grid, a \
pie/donut chart of part-of-whole breakdowns, a bar chart comparing values \
across categories, or anything more structured than plain text — call \
\`generate_a2ui\` to draw it. The registered catalog includes \`Card\`, \
\`StatusBadge\`, \`Metric\`, \`InfoRow\`, \`PrimaryButton\`, \`PieChart\`, and \
\`BarChart\` (in addition to the basic A2UI primitives). Prefer \`PieChart\` \
for part-of-whole breakdowns (sales by region, traffic sources, portfolio \
allocation) and \`BarChart\` for comparisons across categories (quarterly \
revenue, headcount by team, signups per month). \`generate_a2ui\` takes a \
single \`brief\` argument summarising what the UI should communicate. Keep \
chat replies to one short sentence; let the UI do the talking.`;

function createSurfaceOp(
  surfaceId: string,
  catalogId: string = BASIC_CATALOG_ID,
) {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId },
  };
}

function updateComponentsOp(surfaceId: string, components: unknown[]) {
  return {
    version: "v0.9",
    updateComponents: { surfaceId, components },
  };
}

function updateDataModelOp(
  surfaceId: string,
  data: unknown,
  path: string = "/",
) {
  return {
    version: "v0.9",
    updateDataModel: { surfaceId, path, value: data },
  };
}

function renderA2uiOperations(operations: unknown[]) {
  return { [A2UI_OPERATIONS_KEY]: operations };
}

const SECONDARY_LLM_INSTRUCTIONS = `\
You are an A2UI v0.9 component designer. Output ONLY a single JSON object \
matching this exact shape:

{
  "surfaceId": string,    // unique short id, e.g. "dashboard"
  "catalogId": string,    // use "${CUSTOM_CATALOG_ID}"
  "components": [ ... ],  // A2UI v0.9 flat component array; the root MUST have id "root"
  "data": { ... }         // optional flat object for the data model; may be {}
}

Use ONLY components from the registered catalog (described below). For each \
component you emit, set "id" to a unique string and "component" to the \
component name; props go alongside as top-level keys. Compose layouts with \
basic A2UI primitives (Column, Row, Card, Text, …) plus the custom \
components. Do NOT wrap in code fences. Do NOT include any prose outside \
the JSON object.`;

/**
 * Build a per-run `generate_a2ui` tool. Closure-captures `catalogContext` (the
 * registered client catalog schema serialised by the A2UI middleware) and
 * `parentAbortController` so the secondary LLM call aborts with the parent
 * run.
 */
function buildGenerateA2uiTool(
  catalogContext: string,
  parentAbortController: AbortController,
) {
  return toolDefinition({
    name: "generate_a2ui",
    description:
      "Generate dynamic A2UI components based on the conversation. A " +
      "secondary LLM designs the UI schema and data; the result is " +
      "returned as an a2ui_operations container that the runtime's A2UI " +
      "middleware streams to the frontend renderer.",
    inputSchema: z.object({
      brief: z
        .string()
        .describe(
          "A short description of what the UI should communicate (e.g. 'KPI " +
            "dashboard with revenue, signups, churn').",
        ),
    }),
  }).server(async ({ brief }) => {
    const systemPrompt = catalogContext
      ? `${SECONDARY_LLM_INSTRUCTIONS}\n\nRegistered catalog:\n${catalogContext}`
      : SECONDARY_LLM_INSTRUCTIONS;

    const text = await chat({
      adapter: openaiText("gpt-4o"),
      messages: [{ role: "user", content: brief }],
      systemPrompts: [systemPrompt],
      stream: false,
      abortController: parentAbortController,
      modelOptions: {
        response_format: { type: "json_object" },
      },
    });

    let parsed: {
      surfaceId?: string;
      catalogId?: string;
      components?: unknown[];
      data?: Record<string, unknown>;
    };
    try {
      parsed =
        typeof text === "string" ? JSON.parse(text) : (text as typeof parsed);
    } catch {
      return { error: "Secondary LLM returned non-JSON output" };
    }

    const surfaceId = parsed.surfaceId ?? "dynamic-surface";
    const catalogId = parsed.catalogId ?? CUSTOM_CATALOG_ID;
    const components = Array.isArray(parsed.components)
      ? parsed.components
      : [];
    const data = parsed.data ?? {};

    const ops: unknown[] = [
      createSurfaceOp(surfaceId, catalogId),
      updateComponentsOp(surfaceId, components),
    ];
    if (data && Object.keys(data).length > 0) {
      ops.push(updateDataModelOp(surfaceId, data));
    }
    return renderA2uiOperations(ops);
  });
}

/**
 * Built-in agent for the Declarative Generative UI (A2UI — Dynamic Schema)
 * demo.
 *
 * The dedicated runtime (`src/app/api/copilotkit-declarative-gen-ui/route.ts`)
 * runs the A2UI middleware with `injectA2UITool: false` — the agent here
 * owns its own `generate_a2ui` tool, mirroring `langgraph-typescript`'s
 * `a2ui-dynamic.ts`. The middleware still serialises the registered client
 * catalog into the agent's `input.context`; we extract the catalog text from
 * `convertInputToTanStackAI`'s `systemPrompts` aggregator and pass it to the
 * secondary LLM.
 */
export function createDeclarativeGenUIAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);

      // The A2UI middleware injects context entries — include any context
      // entry text in the secondary-LLM prompt so it knows the catalog
      // schema. We grep system prompts that mention `a2ui` (case-insensitive)
      // to capture catalog descriptors without dragging in unrelated app
      // context. Falls back to the full system-prompt block if nothing
      // matched, since correctness > minimality here.
      const catalogContext =
        systemPrompts
          .filter((p) => /a2ui|catalog|component/i.test(p))
          .join("\n\n") || systemPrompts.join("\n\n");

      const generateA2ui = buildGenerateA2uiTool(
        catalogContext,
        abortController,
      );

      return chat({
        adapter: openaiText("gpt-4o"),
        messages,
        systemPrompts: [SYSTEM_PROMPT, ...systemPrompts],
        tools: [generateA2ui],
        abortController,
      });
    },
  });
}
