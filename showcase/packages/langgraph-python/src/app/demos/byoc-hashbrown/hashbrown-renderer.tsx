"use client";

/**
 * HashBrown message renderer for the byoc-hashbrown demo (Wave 4a).
 *
 * Ported from showcase/starters/template/frontend/components/renderers/hashbrown/index.tsx
 * with these adjustments:
 * - MetricCard lives in ./metric-card (extracted module).
 * - Charts live under ./charts/ (co-located in the demo).
 * - SalesStage type lives in ./types.
 *
 * Registers MetricCard + PieChart + BarChart + DealCard + Markdown against the
 * hashbrown schema via `@hashbrownai/react`'s `useUiKit`. Renders assistant
 * messages through `useJsonParser` for progressive JSON→UI streaming.
 *
 * Wire format
 * -----------
 * `useJsonParser(content, kit.schema)` parses a streaming JSON object of the
 * shape produced by `createUiKit(...).schema`:
 *
 *   {
 *     "ui": [
 *       { "metric":   { "props": { "label": "...", "value": "..." } } },
 *       { "pieChart": { "props": { "title": "...", "data": "[{...}]" } } },
 *       { "Markdown": { "props": { "children": "..." } } }
 *     ]
 *   }
 *
 * The `useUiKit({ examples: ... })` `<ui>` JSX is hashbrown's prompt DSL used
 * when hashbrown drives the LLM directly (e.g. `useUiChat`). Because this
 * demo drives the LLM via langgraph, the backend agent
 * (`src/agents/byoc_hashbrown_agent.py`) is responsible for emitting the JSON
 * shape shown above. That agent pins OpenAI JSON mode
 * (`response_format: { type: "json_object" }`) so the wire is always a single
 * parseable object — without JSON mode, gpt-4o-mini routinely wraps output in
 * code fences or prose and `useJsonParser` never resolves a value.
 *
 * Consume the renderer like this in a page:
 *
 *   <HashBrownDashboard>
 *     <CopilotChat RenderMessage={useHashBrownMessageRenderer()} />
 *   </HashBrownDashboard>
 */
import React, { memo } from "react";
import { s, prompt } from "@hashbrownai/core";
import {
  exposeComponent,
  exposeMarkdown,
  useUiKit,
  useJsonParser,
} from "@hashbrownai/react";
import { PieChart } from "./charts/pie-chart";
import { BarChart } from "./charts/bar-chart";
import { MetricCard } from "./metric-card";
import type { SalesStage } from "./types";

/**
 * The underlying PieChart / BarChart components take `data` as a real
 * array, but hashbrown's build-time validator (0.5.0-beta.4) rejects
 * example prompts whose JSX attribute values don't match the schema
 * type — i.e. `data='[{"label":"A","value":1}]'` (string) doesn't pass
 * an `s.streaming.array(...)` schema. And since the LLM streams JSON as
 * text anyway, modeling `data` as a string prop and parsing inside the
 * component is the path the example syntax naturally supports.
 *
 * These wrappers accept `data: string`, JSON-parse it, and render the
 * real chart. Defensive — silently render nothing if parse fails mid-
 * stream (hashbrown feeds partial tokens while streaming).
 */
type ChartSlice = { label: string; value: number };

function parseChartData(data: string): ChartSlice[] | null {
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return null;
    return parsed as ChartSlice[];
  } catch {
    return null;
  }
}

function PieChartWithStringData({
  title,
  data,
}: {
  title: string;
  data: string;
}) {
  const parsed = parseChartData(data);
  if (!parsed) return null;
  return <PieChart title={title} description="" data={parsed} />;
}

function BarChartWithStringData({
  title,
  data,
}: {
  title: string;
  data: string;
}) {
  const parsed = parseChartData(data);
  if (!parsed) return null;
  return <BarChart title={title} description="" data={parsed} />;
}

/**
 * Minimal local types for the CopilotChat RenderMessage slot + AG-UI
 * assistant message shape. These mirror `RenderMessageProps` from
 * `@copilotkit/react-ui` and `AssistantMessage` from `@ag-ui/core`, inlined
 * to avoid adding those packages as direct dependencies of langgraph-python
 * (they come in transitively via `@copilotkit/react-core`).
 *
 * Only the fields the renderer reads are declared.
 */
interface LocalAssistantMessage {
  role: "assistant";
  content?: string;
}

interface LocalChatMessage {
  role: string;
  content?: string;
  id?: string;
}

interface LocalRenderMessageProps {
  message: LocalChatMessage;
  // CopilotChatMessageView passes these to every slotted assistantMessage.
  // We use `messages` + this message's id to tell whether *this* message is
  // the currently-streaming one so we can show a placeholder instead of a
  // silent `null`.
  messages?: LocalChatMessage[];
  isRunning?: boolean;
}

// ---------------------------------------------------------------------------
// Standalone DealCard for the kit (flat props, no SalesTodo dependency)
// ---------------------------------------------------------------------------

interface HashBrownDealCardProps {
  title: string;
  stage: SalesStage;
  value: number;
  assignee?: string;
  dueDate?: string;
}

const STAGE_COLORS: Record<SalesStage, string> = {
  prospect: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  qualified:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  proposal: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  negotiation:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  "closed-won":
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "closed-lost": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function DealCardComponent({
  title,
  stage,
  value,
  assignee,
  dueDate,
}: HashBrownDealCardProps) {
  const badgeClass =
    STAGE_COLORS[stage] ??
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";

  return (
    <div
      data-testid="hashbrown-deal-card"
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <h3 className="text-sm font-semibold leading-snug text-[var(--foreground)]">
        {title}
      </h3>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
        >
          {stage}
        </span>
        <span className="text-sm font-semibold text-[var(--foreground)]">
          ${(value ?? 0).toLocaleString()}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
        {assignee && <span>{assignee}</span>}
        {dueDate && <span>Due {dueDate}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kit definition
// ---------------------------------------------------------------------------

export function useSalesDashboardKit() {
  return useUiKit({
    examples: prompt`
      # Mixing components and Markdown:
      <ui>
        <Markdown children="## Q4 Sales Summary" />
        <metric label="Total Revenue" value="$1.2M" />
        <Markdown children="Revenue breakdown by segment:" />
        <pieChart title="Revenue by Segment" data='[{"label":"Enterprise","value":600000},{"label":"SMB","value":400000},{"label":"Startup","value":200000}]' />
        <barChart title="Monthly Trend" data='[{"label":"Oct","value":350000},{"label":"Nov","value":400000},{"label":"Dec","value":450000}]' />
        <dealCard title="Acme Corp Renewal" stage="negotiation" value="250000" />
      </ui>

      Hint: use Markdown for explanatory text between visual components.
      Hint: always include title and data for charts. Data is a JSON-encoded
      array of {label, value} objects as a string.
    `,
    components: [
      exposeMarkdown(),
      exposeComponent(MetricCard, {
        name: "metric",
        description: "A KPI metric card with label, value, and optional trend",
        // Note on "optional" props: @hashbrownai/core@0.5.0-beta.4 dropped
        // the `.optional()` chain in favor of treating component prop schemas
        // as Partial at the exposeComponent layer. We omit optional keys from
        // the schema and surface their existence to the LLM via the
        // `examples` prompt above and the natural-language `description`.
        props: {
          label: s.string("The metric label/name"),
          value: s.string("The metric value (formatted)"),
        },
      }),
      exposeComponent(PieChartWithStringData, {
        name: "pieChart",
        description:
          "A donut/pie chart. `data` is a JSON-encoded string of an " +
          "array of {label, value} segments, e.g. " +
          '\'[{"label":"A","value":1}]\'.',
        props: {
          title: s.string("Chart title"),
          data: s.string("JSON array of {label, value} segments"),
        },
      }),
      exposeComponent(BarChartWithStringData, {
        name: "barChart",
        description:
          "A vertical bar chart. `data` is a JSON-encoded string of an " +
          "array of {label, value} bars, e.g. " +
          '\'[{"label":"A","value":1}]\'.',
        props: {
          title: s.string("Chart title"),
          data: s.string("JSON array of {label, value} bars"),
        },
      }),
      exposeComponent(DealCardComponent, {
        name: "dealCard",
        description: "A sales deal card showing pipeline stage and value",
        props: {
          title: s.string("Deal title"),
          stage: s.enumeration("Pipeline stage", [
            "prospect",
            "qualified",
            "proposal",
            "negotiation",
            "closed-won",
            "closed-lost",
          ]),
          value: s.number("Deal value in dollars"),
        },
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Custom message renderer
// ---------------------------------------------------------------------------

const AssistantMessageRenderer = memo(function AssistantMessageRenderer({
  message,
  kit,
  isStreaming,
}: {
  message: LocalAssistantMessage;
  kit: ReturnType<typeof useSalesDashboardKit>;
  isStreaming: boolean;
}) {
  const content = message.content ?? "";
  const { value } = useJsonParser(content, kit.schema);

  // During streaming, `value` remains undefined until the JSON object has
  // advanced far enough for the schema to resolve at least the outer `ui`
  // array. Show a subtle placeholder rather than rendering nothing — the
  // previous silent-null path was indistinguishable from a broken runtime.
  if (!value) {
    if (isStreaming) {
      return (
        <div
          data-testid="hashbrown-stream-placeholder"
          className="mt-2 flex w-full justify-start"
        >
          <div className="w-full rounded-md border border-dashed border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm text-[var(--muted-foreground)]">
            Generating dashboard…
          </div>
        </div>
      );
    }
    // Stream is done but `useJsonParser` never produced a value. Almost
    // always means the model ignored the JSON-envelope instructions (e.g.
    // emitted prose or code-fenced JSON). Surface the raw content instead
    // of rendering an invisible message so the user sees *something* and we
    // can diagnose prompt drift from the UI.
    if (content.trim().length > 0) {
      return (
        <div
          data-testid="hashbrown-fallback-content"
          className="mt-2 flex w-full justify-start"
        >
          <pre className="w-full overflow-x-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs text-[var(--muted-foreground)]">
            {content}
          </pre>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mt-2 flex w-full justify-start">
      <div className="w-full px-1 py-1">{kit.render(value)}</div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Exported dashboard provider + renderer hook
// ---------------------------------------------------------------------------

export interface HashBrownDashboardProps {
  /**
   * Optional custom wrapper for the assistant message area.
   * Defaults to rendering messages inline.
   */
  children?: React.ReactNode;
}

/**
 * Provider that instantiates the HashBrown kit ONCE and shares it via context.
 * Both the dashboard layout and message renderer consume the same kit instance.
 *
 * The kit registers MetricCard, PieChart, BarChart, DealCard, and Markdown
 * components. Agent context forwarding for output_schema is omitted because
 * the npm-published react-core may not export useAgentContext yet.
 */
const HashBrownKitContext = React.createContext<ReturnType<
  typeof useSalesDashboardKit
> | null>(null);

function useHashBrownKit() {
  const kit = React.useContext(HashBrownKitContext);
  if (!kit)
    throw new Error("useHashBrownKit must be used within HashBrownDashboard");
  return kit;
}

export function HashBrownDashboard({ children }: HashBrownDashboardProps) {
  const kit = useSalesDashboardKit();

  // Note: Agent context forwarding (useAgentContext) for output_schema is
  // omitted because the npm-published react-core may not export it yet.

  return (
    <HashBrownKitContext.Provider value={kit}>
      {children}
    </HashBrownKitContext.Provider>
  );
}

/**
 * Stable message renderer component that consumes the kit from context.
 * Defined at module level to avoid unstable function identity.
 */
function HashBrownRenderMessage({
  message,
  messages,
  isRunning,
}: LocalRenderMessageProps) {
  const kit = useHashBrownKit();
  if (message.role !== "assistant") return null;

  // Only the tail assistant message is considered "streaming"; older
  // assistant messages in history are complete even while a new run is in
  // progress.
  const lastMessage = messages?.[messages.length - 1];
  const isStreaming = Boolean(
    isRunning && lastMessage && lastMessage.id === message.id,
  );

  return (
    <AssistantMessageRenderer
      message={message as LocalAssistantMessage}
      kit={kit}
      isStreaming={isStreaming}
    />
  );
}

/**
 * Returns the stable HashBrownRenderMessage component.
 * Must be used within a HashBrownDashboard provider.
 */
export function useHashBrownMessageRenderer() {
  return HashBrownRenderMessage;
}
