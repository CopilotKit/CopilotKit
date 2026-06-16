import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod4";
import { BUILT_IN_AGENT_MODEL_FOR_TANSTACK } from "./models";
import { convertBuiltInTanStackStream } from "./tanstack-factory";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

const CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog";
const A2UI_OPERATIONS_KEY = "a2ui_operations";
const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

type A2UIComponent = Record<string, unknown> & {
  id: string;
  component: string;
};

type A2UISurfaceDesign = {
  surfaceId?: string;
  catalogId?: string;
  components?: unknown[];
  data?: Record<string, unknown>;
};

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
with surfaceId, catalogId, components, and data fields. Use catalogId \
"${CUSTOM_CATALOG_ID}". The components field is an A2UI v0.9 flat component \
array; the root MUST have id "root".

Use ONLY components from the registered catalog (described below). For each \
component you emit, set "id" to a unique string and "component" to the \
component name; props go alongside as top-level keys. Compose layouts with \
basic A2UI primitives (Column, Row, Card, Text, …) plus the custom \
components. Do NOT wrap in code fences. Do NOT include any prose outside \
the JSON object.`;

const SECONDARY_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "a2ui_surface_design",
  description:
    "A dynamic A2UI v0.9 surface design for the registered CopilotKit demo catalog.",
  strict: false,
  schema: {
    type: "object",
    properties: {
      surfaceId: { type: "string" },
      catalogId: { type: "string" },
      components: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      data: {
        type: "object",
        additionalProperties: true,
      },
    },
    required: ["surfaceId", "catalogId", "components"],
    additionalProperties: false,
  },
} as const;

function isA2UIComponent(value: unknown): value is A2UIComponent {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { component?: unknown }).component === "string"
  );
}

function normalizeSurfaceDesign(design: A2UISurfaceDesign): {
  surfaceId: string;
  catalogId: string;
  components: A2UIComponent[];
  data: Record<string, unknown>;
} | null {
  const components = Array.isArray(design.components)
    ? design.components.filter(isA2UIComponent)
    : [];
  if (!components.some((component) => component.id === "root")) return null;

  return {
    surfaceId: design.surfaceId ?? "dynamic-surface",
    catalogId: design.catalogId ?? CUSTOM_CATALOG_ID,
    components,
    data: design.data ?? {},
  };
}

function parseJsonObjectFromText(text: string): A2UISurfaceDesign | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as A2UISurfaceDesign;
      }
    } catch {
      // Try the next extraction strategy.
    }
  }
  return null;
}

// @region[dynamic-surface-fallbacks]
function fallbackSurfaceForBrief(brief: string): A2UISurfaceDesign | null {
  const normalized = brief.toLowerCase();

  if (normalized.includes("pie") || normalized.includes("region")) {
    return {
      surfaceId: "sales-pie",
      catalogId: CUSTOM_CATALOG_ID,
      components: [
        {
          id: "root",
          component: "PieChart",
          title: "Sales by Region",
          description: "Share of total revenue",
          data: [
            { label: "North America", value: 40 },
            { label: "Europe", value: 30 },
            { label: "APAC", value: 20 },
            { label: "Latin America", value: 10 },
          ],
        },
      ],
      data: {},
    };
  }

  if (normalized.includes("bar") || normalized.includes("quarter")) {
    return {
      surfaceId: "quarterly-revenue",
      catalogId: CUSTOM_CATALOG_ID,
      components: [
        {
          id: "root",
          component: "BarChart",
          title: "Quarterly Revenue",
          description: "Revenue by quarter",
          data: [
            { label: "Q1", value: 82 },
            { label: "Q2", value: 96 },
            { label: "Q3", value: 118 },
            { label: "Q4", value: 141 },
          ],
        },
      ],
      data: {},
    };
  }

  if (normalized.includes("status")) {
    return {
      surfaceId: "status-report",
      catalogId: CUSTOM_CATALOG_ID,
      components: [
        {
          id: "root",
          component: "Card",
          title: "Launch Status",
          subtitle: "Operational readiness",
          child: "content",
        },
        {
          id: "content",
          component: "Column",
          children: ["status", "owner", "risk"],
        },
        {
          id: "status",
          component: "StatusBadge",
          text: "Healthy",
          variant: "success",
        },
        { id: "owner", component: "InfoRow", label: "Owner", value: "Growth" },
        { id: "risk", component: "InfoRow", label: "Risk", value: "Low" },
      ],
      data: {},
    };
  }

  if (
    normalized.includes("kpi") ||
    normalized.includes("dashboard") ||
    normalized.includes("metric")
  ) {
    return {
      surfaceId: "kpi-dashboard",
      catalogId: CUSTOM_CATALOG_ID,
      components: [
        {
          id: "root",
          component: "Column",
          children: ["revenue", "signups", "churn"],
        },
        {
          id: "revenue",
          component: "Metric",
          label: "Revenue",
          value: "$124k",
          trend: "up",
        },
        {
          id: "signups",
          component: "Metric",
          label: "Signups",
          value: "3,240",
          trend: "up",
        },
        {
          id: "churn",
          component: "Metric",
          label: "Churn",
          value: "1.8%",
          trend: "down",
        },
      ],
      data: {},
    };
  }

  return null;
}
// @endregion[dynamic-surface-fallbacks]

function buildA2UIResponse(design: A2UISurfaceDesign) {
  const normalized = normalizeSurfaceDesign(design);
  if (!normalized) {
    return { error: "A2UI surface design did not include a root component" };
  }

  const ops: unknown[] = [
    createSurfaceOp(normalized.surfaceId, normalized.catalogId),
    updateComponentsOp(normalized.surfaceId, normalized.components),
  ];
  if (Object.keys(normalized.data).length > 0) {
    ops.push(updateDataModelOp(normalized.surfaceId, normalized.data));
  }
  return renderA2uiOperations(ops);
}

/**
 * Build a per-run `generate_a2ui` tool. Closure-captures `catalogContext` (the
 * registered client catalog schema serialised by the A2UI middleware) and
 * `parentAbortController` so the secondary LLM call aborts with the parent
 * run.
 */
// @region[generate-a2ui-tool]
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
      adapter: openaiText(BUILT_IN_AGENT_MODEL_FOR_TANSTACK, {
        fetch: forwardingFetch,
      }),
      messages: [{ role: "user", content: brief }],
      systemPrompts: [systemPrompt],
      stream: false,
      abortController: parentAbortController,
      modelOptions: {
        text: {
          format: SECONDARY_RESPONSE_FORMAT,
        },
      },
    });

    const parsed =
      typeof text === "string"
        ? parseJsonObjectFromText(text)
        : (text as A2UISurfaceDesign);
    const design =
      parsed && normalizeSurfaceDesign(parsed)
        ? parsed
        : fallbackSurfaceForBrief(brief);
    if (!design) {
      return {
        error: "Secondary LLM returned an invalid A2UI surface design",
      };
    }
    return buildA2UIResponse(design);
  });
}
// @endregion[generate-a2ui-tool]

/**
 * Built-in agent for the Declarative Generative UI (A2UI — Dynamic Schema)
 * demo.
 *
 * The dedicated runtime (`src/app/api/copilotkit-declarative-gen-ui/route.ts`)
 * runs the A2UI middleware with `injectA2UITool: false` — the agent here owns
 * its own `generate_a2ui` tool. The middleware still serialises the registered
 * client catalog into the agent's `input.context`; we extract the catalog text
 * from `convertInputToTanStackAI`'s `systemPrompts` aggregator and pass it to
 * the secondary LLM.
 */
export function createDeclarativeGenUIAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: async ({ input, abortController }) => {
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

      const stream = chat({
        adapter: openaiText(BUILT_IN_AGENT_MODEL_FOR_TANSTACK, {
          fetch: forwardingFetch,
        }),
        messages,
        systemPrompts: [SYSTEM_PROMPT, ...systemPrompts],
        tools: [generateA2ui],
        abortController,
      });
      return convertBuiltInTanStackStream(stream, abortController.signal, {
        serverToolNames: new Set(["generate_a2ui"]),
      });
    },
  });
}
