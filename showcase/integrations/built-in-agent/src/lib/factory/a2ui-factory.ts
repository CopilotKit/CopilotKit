import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

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

// Generation RULES ported from the canonical Python SDK
// (`sdk-python/copilotkit/a2ui.py` DEFAULT_GENERATION_GUIDELINES), re-authored
// for THIS demo's FLAT catalog. The canonical prose ships List/form/
// repeating-card + path-binding patterns; this catalog (Metric / PieChart /
// BarChart / DataTable / InfoRow / StatusBadge / Card composed with Row /
// Column / Text) has NO List/form/repeating-card construct and binds NOTHING
// to the data model, so those patterns are deliberately OMITTED — porting them
// verbatim would steer the LLM into List/path shapes this catalog cannot
// resolve. We keep the rules that matter here: single-`root`, the DAG /
// no-self-reference contract, and the inline-literal-only rule (the
// literal-vs-`{path}` crash rule).
const SECONDARY_LLM_INSTRUCTIONS = `\
You are an A2UI v0.9 component designer. Output ONLY a single JSON object \
matching this exact shape (no code fences, no prose outside the JSON):

{
  "surfaceId": string,    // unique short id, e.g. "sales-dashboard"
  "catalogId": string,    // use "${CUSTOM_CATALOG_ID}"
  "components": [ ... ],  // A2UI v0.9 flat component array (see RULES)
  "data": { ... }         // leave as {} — this catalog uses inline literals only
}

For each component, set "id" to a unique string and "component" to the \
component name; put all props alongside as top-level keys. Use ONLY \
components from the registered catalog (described below) plus the basic \
A2UI layout primitives (Row, Column, Text).

COMPONENT ID RULES (a tree that breaks these renders NOTHING):
- Exactly ONE component MUST have id "root". This is the surface entry \
point — the renderer begins at "root" and walks the child/children tree from \
there. Every other component must be reachable from "root". If no component \
has id "root", the surface renders an empty loading placeholder and none of \
your components show.
- Every component id must be unique within the surface.
- A component MUST NOT reference itself as child/children (e.g. id "card" \
must not list "card" as a child) — that is a circular dependency. The \
child/children tree must be a DAG; no cycles.

LAYOUT:
- Use "Row" (with "gap" and a "children" array of ids) to place tiles \
side by side; use "Column" (with "gap" and a "children" array of ids) to \
stack sections. A "Card" wraps a single child id via its "child" prop — to \
put several components in a Card, point "child" at a Column.

COMPONENT VALUES — INLINE LITERALS ONLY:
Pass every prop as an inline literal value (strings, numbers, arrays, \
objects) directly on the component. This catalog does NOT declare path \
support on ANY property, so NEVER use a { "path": "..." } object for a prop \
value — doing so crashes the render. Keep the top-level "data" field {}.
- A Metric's "value" is an inline string: "value": "$4.2M".
- A chart's "data" is an inline array: \
"data": [{"label":"NA","value":1900000},{"label":"EMEA","value":1300000}].
- A DataTable's "columns"/"rows" are inline arrays; every row's keys MUST \
match the declared "columns[].key".`;

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
      adapter: openaiText("gpt-4o", { fetch: forwardingFetch }),
      messages: [{ role: "user", content: brief }],
      systemPrompts: [systemPrompt],
      stream: false,
      abortController: parentAbortController,
      modelOptions: {
        response_format: { type: "json_object" },
      },
    });

    // A non-string `chat()` return cannot be parsed and must not be
    // blind-cast: doing so lets an unexpected envelope slip past the catch and
    // get misreported downstream as "no components" instead of naming the real
    // cause. Fail loud here.
    if (typeof text !== "string") {
      return {
        error:
          "Secondary LLM returned a non-string result (expected a JSON " +
          "string) — cannot parse the A2UI schema.",
      };
    }

    let parsed: {
      surfaceId?: string;
      catalogId?: string;
      components?: unknown[];
      data?: Record<string, unknown>;
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "Secondary LLM returned non-JSON output" };
    }

    const surfaceId = parsed.surfaceId ?? "dynamic-surface";
    const catalogId = parsed.catalogId ?? CUSTOM_CATALOG_ID;
    const components = Array.isArray(parsed.components)
      ? parsed.components
      : [];
    const data = parsed.data ?? {};

    // Output validation (fail loud, not silent-no-paint). What is validated
    // here: (1) a non-empty `components` array, (2) presence of an `id:"root"`
    // node (the renderer entry point is hardcoded to id "root" / base path
    // "/", so a tree missing either genuinely renders nothing — the surface
    // holds in its loading placeholder, the `surface-missing` failure), and
    // (3) component ids are unique (a duplicate id makes the tree ambiguous to
    // the renderer). Surface these as typed errors so the demo fails visibly
    // rather than streaming an empty/ambiguous surface.
    //
    // NOT validated here: no-cycle and reachable-from-root. Those require graph
    // traversal and are not enforced — a cyclic/orphan tree from the secondary
    // LLM is not a realistic failure mode, and the tree is trusted from the
    // renderer's perspective beyond the cheap structural checks above.
    if (components.length === 0) {
      return {
        error:
          "Secondary LLM returned no components — nothing to render on the A2UI surface.",
      };
    }
    const hasRoot = components.some(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { id?: unknown }).id === "root",
    );
    if (!hasRoot) {
      return {
        error:
          'Secondary LLM output has no component with id "root" — the A2UI ' +
          "renderer begins at root, so the surface would render empty.",
      };
    }
    // Cheap O(n) unique-id check (no traversal): a duplicate id makes the tree
    // ambiguous for the renderer. Compare collected ids against their Set size.
    const ids = components
      .filter((c): c is { id?: unknown } => typeof c === "object" && c !== null)
      .map((c) => c.id)
      .filter((id): id is string => typeof id === "string");
    if (ids.length !== new Set(ids).size) {
      return {
        error:
          "Secondary LLM output has duplicate component ids — the A2UI " +
          "renderer requires unique ids, so the tree is ambiguous to render.",
      };
    }

    // `data` MUST be a plain object before it becomes an `updateDataModel`
    // value. A non-object (string -> char-index keys, array -> numeric-index
    // keys) still passes `Object.keys(...).length > 0`, so it would emit a
    // malformed op. Fail loud rather than stream a broken data model.
    const isPlainObject =
      typeof data === "object" && data !== null && !Array.isArray(data);
    if (!isPlainObject) {
      return {
        error:
          'Secondary LLM "data" field is not a plain object — the A2UI data ' +
          "model requires an object value, so this would emit a malformed " +
          "updateDataModel op.",
      };
    }

    const ops: unknown[] = [
      createSurfaceOp(surfaceId, catalogId),
      updateComponentsOp(surfaceId, components),
    ];
    if (Object.keys(data).length > 0) {
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
        adapter: openaiText("gpt-4o", { fetch: forwardingFetch }),
        messages,
        systemPrompts: [SYSTEM_PROMPT, ...systemPrompts],
        tools: [generateA2ui],
        abortController,
      });
    },
  });
}
