"use client";

/**
 * HashBrown message renderer for the Spring AI byoc-hashbrown demo.
 *
 * Registers MetricCard + PieChart + BarChart + DealCard + Markdown against
 * the hashbrown schema via `@hashbrownai/react`'s `useUiKit`. Renders
 * assistant messages through `useJsonParser` for progressive JSON->UI
 * streaming.
 *
 * NOTE: Spring AI's ChatClient streams text tokens, but it does not natively
 * emit per-token *structured* output that conforms to a schema. The agent
 * is prompted to return a JSON shape that hashbrown's `useJsonParser` can
 * progressively parse from the streaming text. Final-shape correctness
 * depends on the model following the prompt; the renderer is defensive
 * and silently no-ops on partial / malformed JSON.
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

interface LocalAssistantMessage {
  role: "assistant";
  content?: string;
}

interface LocalChatMessage {
  role: string;
  content?: string;
}

interface LocalRenderMessageProps {
  message: LocalChatMessage;
}

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

export function useSalesDashboardKit() {
  return useUiKit({
    examples: prompt`
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

const AssistantMessageRenderer = memo(function AssistantMessageRenderer({
  message,
  kit,
}: {
  message: LocalAssistantMessage;
  kit: ReturnType<typeof useSalesDashboardKit>;
}) {
  const { value } = useJsonParser(message.content ?? "", kit.schema);
  if (!value) return null;
  return (
    <div
      data-testid="copilot-assistant-message"
      className="mt-2 flex w-full justify-start"
    >
      <div className="w-full px-1 py-1">{kit.render(value)}</div>
    </div>
  );
});

export interface HashBrownDashboardProps {
  children?: React.ReactNode;
}

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
  return (
    <HashBrownKitContext.Provider value={kit}>
      {children}
    </HashBrownKitContext.Provider>
  );
}

function HashBrownRenderMessage({ message }: LocalRenderMessageProps) {
  const kit = useHashBrownKit();
  if (message.role === "assistant") {
    return (
      <AssistantMessageRenderer
        message={message as LocalAssistantMessage}
        kit={kit}
      />
    );
  }
  return null;
}

export function useHashBrownMessageRenderer() {
  return HashBrownRenderMessage;
}
