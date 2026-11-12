"use client";

import { useLayoutEffect, useState } from "react";
import { SiteNav, PageHeader } from "@/components/Brand";
import { HttpAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import { CopilotKitProvider } from "@copilotkit/react-core";
import {
  GenerativeUISurface,
  useGenerativeUIFunction,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/generative-ui";
import { catalog, CATALOG_ID } from "@/a2ui/catalog";

/* Each example renders a complete tiny surface. The components are A2UI
 * component nodes, the shape the agent's surfaces have once the runtime has
 * converted them to A2UI 1.0, so the showcase doubles as a sanity check on
 * the catalog. */
type Example = {
  group: "layout" | "content" | "data" | "interactive";
  name: string;
  blurb: string;
  surface: {
    components: unknown[];
    data?: Record<string, unknown>;
  };
};

const sampleSeries = [
  { label: "Jan", value: 24 },
  { label: "Feb", value: 32 },
  { label: "Mar", value: 38 },
  { label: "Apr", value: 44 },
  { label: "May", value: 41 },
  { label: "Jun", value: 52 },
];

const sampleShare = [
  { label: "NA", value: 480 },
  { label: "EMEA", value: 320 },
  { label: "APAC", value: 200 },
  { label: "LATAM", value: 80 },
];

const sampleRows = [
  { name: "Acme", category: "Mid-market", value: "$48k", delta: "+8%" },
  { name: "Northwind", category: "Enterprise", value: "$112k", delta: "+12%" },
  { name: "Globex", category: "SMB", value: "$22k", delta: "-3%" },
  { name: "Initech", category: "Mid-market", value: "$61k", delta: "+5%" },
];

const sampleRanked = [
  { label: "Atlas Industries Pte Ltd", value: 1280 },
  { label: "Northwind Logistics", value: 940 },
  { label: "Globex International", value: 720 },
  { label: "Initech Holdings", value: 510 },
  { label: "Stark Manufacturing", value: 380 },
];

const sampleScatter = [
  { x: 1, y: 22 },
  { x: 2, y: 28 },
  { x: 3, y: 31 },
  { x: 4, y: 35 },
  { x: 5, y: 41 },
  { x: 6, y: 39 },
  { x: 7, y: 47 },
  { x: 8, y: 52 },
  { x: 9, y: 56 },
  { x: 10, y: 61 },
  { x: 11, y: 64 },
  { x: 12, y: 70 },
];

const EXAMPLES: Example[] = [
  {
    group: "layout",
    name: "Stack",
    blurb:
      "Vertical layout container. Arranges any children top to bottom with consistent gap. The default container for surfaces and sections.",
    surface: {
      components: [
        {
          id: "root",
          component: "Stack",
          gap: "sm",
          children: ["c1", "c2", "c3"],
        },
        { id: "c1", component: "Card", child: "c1-text", tone: "default" },
        {
          id: "c1-text",
          component: "Text",
          text: "First card.",
          weight: "medium",
        },
        { id: "c2", component: "Card", child: "c2-text", tone: "lilac" },
        {
          id: "c2-text",
          component: "Text",
          text: "Second card.",
          weight: "medium",
        },
        { id: "c3", component: "Card", child: "c3-text", tone: "default" },
        {
          id: "c3-text",
          component: "Text",
          text: "Third card.",
          weight: "medium",
        },
      ],
    },
  },
  {
    group: "layout",
    name: "Row",
    blurb:
      "Horizontal layout. One Row = one horizontal line of children. Stack multiple Rows for table-like layouts; use a single Row for toolbars, metadata strips, and action bars. Shown here: two Rows inside a Stack so the unit of horizontal layout is visible.",
    surface: {
      components: [
        { id: "root", component: "Stack", gap: "xs", children: ["r1", "r2"] },
        {
          id: "r1",
          component: "Row",
          gap: "sm",
          align: "center",
          children: ["r1-name", "r1-sep", "r1-owner", "r1-badge"],
        },
        {
          id: "r1-name",
          component: "Text",
          text: "Atlas migration",
          weight: "medium",
        },
        { id: "r1-sep", component: "Text", text: "·", tone: "muted" },
        {
          id: "r1-owner",
          component: "Text",
          text: "Priya",
          tone: "muted",
          size: "sm",
        },
        {
          id: "r1-badge",
          component: "Badge",
          label: "In progress",
          tone: "warning",
        },
        {
          id: "r2",
          component: "Row",
          gap: "sm",
          align: "center",
          children: ["r2-name", "r2-sep", "r2-owner", "r2-badge"],
        },
        {
          id: "r2-name",
          component: "Text",
          text: "Phoenix launch",
          weight: "medium",
        },
        { id: "r2-sep", component: "Text", text: "·", tone: "muted" },
        {
          id: "r2-owner",
          component: "Text",
          text: "Sam",
          tone: "muted",
          size: "sm",
        },
        { id: "r2-badge", component: "Badge", label: "Done", tone: "positive" },
      ],
    },
  },
  {
    group: "layout",
    name: "Grid",
    blurb: "Responsive grid (cols 1 to 6).",
    surface: {
      components: [
        {
          id: "root",
          component: "Grid",
          columns: 3,
          gap: "sm",
          children: ["s1", "s2", "s3"],
        },
        {
          id: "s1",
          component: "StatCard",
          label: "Revenue",
          value: "$1.2M",
          delta: "+18%",
          deltaTone: "positive",
        },
        {
          id: "s2",
          component: "StatCard",
          label: "Customers",
          value: "2,940",
          delta: "+7%",
          deltaTone: "positive",
        },
        {
          id: "s3",
          component: "StatCard",
          label: "Churn",
          value: "4.4%",
          delta: "+0.4%",
          deltaTone: "negative",
        },
      ],
    },
  },
  {
    group: "layout",
    name: "Card",
    blurb: "Bordered, padded surface. Tone variants for emphasis.",
    surface: {
      components: [
        { id: "root", component: "Row", gap: "sm", children: ["c1", "c2"] },
        { id: "c1", component: "Card", child: "c1-text", tone: "default" },
        { id: "c1-text", component: "Text", text: "Default tone." },
        { id: "c2", component: "Card", child: "c2-text", tone: "lilac" },
        {
          id: "c2-text",
          component: "Text",
          text: "Lilac tone.",
          weight: "medium",
        },
      ],
    },
  },
  {
    group: "layout",
    name: "Section",
    blurb:
      "Overline + title + a single child component. Use to label a region of the surface.",
    surface: {
      components: [
        {
          id: "root",
          component: "Section",
          eyebrow: "OVERVIEW · Q1",
          title: "Quarterly revenue",
          child: "card",
        },
        { id: "card", component: "Card", child: "text" },
        {
          id: "text",
          component: "Text",
          text: "Total revenue grew 18% QoQ, driven by mid-market expansion.",
          tone: "muted",
        },
      ],
    },
  },
  {
    group: "layout",
    name: "Divider",
    blurb: "1px line between sections.",
    surface: {
      components: [
        {
          id: "root",
          component: "Stack",
          gap: "sm",
          children: ["t1", "d", "t2"],
        },
        { id: "t1", component: "Text", text: "Above the line." },
        { id: "d", component: "Divider" },
        { id: "t2", component: "Text", text: "Below the line.", tone: "muted" },
      ],
    },
  },

  {
    group: "content",
    name: "Heading",
    blurb: "Level 1/2/3 for page, section, sub-block.",
    surface: {
      components: [
        {
          id: "root",
          component: "Stack",
          gap: "xs",
          children: ["h1", "h2", "h3"],
        },
        { id: "h1", component: "Heading", level: "1", text: "Heading 1" },
        { id: "h2", component: "Heading", level: "2", text: "Heading 2" },
        { id: "h3", component: "Heading", level: "3", text: "Heading 3" },
      ],
    },
  },
  {
    group: "content",
    name: "Text",
    blurb: "Body copy. Tone, size, weight.",
    surface: {
      components: [
        {
          id: "root",
          component: "Stack",
          gap: "xs",
          children: ["t1", "t2", "t3"],
        },
        {
          id: "t1",
          component: "Text",
          text: "Default body copy.",
          weight: "medium",
        },
        {
          id: "t2",
          component: "Text",
          text: "Muted secondary text.",
          tone: "muted",
        },
        {
          id: "t3",
          component: "Text",
          text: "Small caption.",
          tone: "muted",
          size: "sm",
        },
      ],
    },
  },
  {
    group: "content",
    name: "Overline",
    blurb:
      "Tiny ALL-CAPS mono label that sits above a heading. The 'overline' typography pattern (Material Design term). Use for category labels.",
    surface: {
      components: [
        { id: "root", component: "Stack", gap: "xs", children: ["e", "h"] },
        { id: "e", component: "Overline", text: "DEMO · 03" },
        { id: "h", component: "Heading", level: "2", text: "Section heading" },
      ],
    },
  },
  {
    group: "content",
    name: "Badge",
    blurb: "Inline status pill. 5 tones.",
    surface: {
      components: [
        {
          id: "root",
          component: "Row",
          gap: "xs",
          children: ["b1", "b2", "b3", "b4", "b5"],
        },
        { id: "b1", component: "Badge", label: "Neutral", tone: "neutral" },
        { id: "b2", component: "Badge", label: "Info", tone: "info" },
        { id: "b3", component: "Badge", label: "Positive", tone: "positive" },
        { id: "b4", component: "Badge", label: "Warning", tone: "warning" },
        { id: "b5", component: "Badge", label: "Danger", tone: "danger" },
      ],
    },
  },
  {
    group: "content",
    name: "Callout",
    blurb: "Block-level highlight for a key insight or definition.",
    surface: {
      components: [
        { id: "root", component: "Stack", gap: "sm", children: ["c1", "c2"] },
        {
          id: "c1",
          component: "Callout",
          tone: "info",
          title: "Key insight",
          body: "Transformers replaced recurrence with attention, so every token can read every other token in one step.",
        },
        {
          id: "c2",
          component: "Callout",
          tone: "warning",
          title: "Caveat",
          body: "The attention layer scales quadratically with sequence length. Long contexts get expensive fast.",
        },
      ],
    },
  },
  {
    group: "content",
    name: "BulletList",
    blurb:
      "Short bulleted or numbered enumerations. Pass `ordered: true` for a numbered list.",
    surface: {
      components: [
        {
          id: "root",
          component: "Stack",
          gap: "md",
          children: ["h1", "ul", "h2", "ol"],
        },
        { id: "h1", component: "Overline", text: "BULLETED" },
        {
          id: "ul",
          component: "BulletList",
          items: [
            "A new attention mechanism that scales near-linearly.",
            "A training recipe that halves wall-clock time.",
            "An evaluation benchmark released alongside the paper.",
          ],
        },
        { id: "h2", component: "Overline", text: "NUMBERED" },
        {
          id: "ol",
          component: "BulletList",
          ordered: true,
          items: ["Read the abstract.", "Skim Table 3.", "Run the colab."],
        },
      ],
    },
  },

  {
    group: "data",
    name: "StatCard",
    blurb: "Single-metric card with delta + caption.",
    surface: {
      components: [
        {
          id: "root",
          component: "StatCard",
          label: "MRR",
          value: "$48,200",
          delta: "+12.4%",
          deltaTone: "positive",
          caption: "vs. prev month",
        },
      ],
    },
  },
  {
    group: "data",
    name: "BarChart",
    blurb: "Vertical bars from [{label,value}]. Use when labels are short.",
    surface: {
      components: [
        { id: "root", component: "BarChart", height: 220, data: sampleSeries },
      ],
    },
  },
  {
    group: "data",
    name: "HorizontalBarChart",
    blurb: "Bars rendered as rows. Use for ranked lists where labels are long.",
    surface: {
      components: [
        {
          id: "root",
          component: "HorizontalBarChart",
          height: 240,
          data: sampleRanked,
        },
      ],
    },
  },
  {
    group: "data",
    name: "LineChart",
    blurb: "Time-series line for trends where direction matters.",
    surface: {
      components: [
        { id: "root", component: "LineChart", height: 220, data: sampleSeries },
      ],
    },
  },
  {
    group: "data",
    name: "DonutChart",
    blurb: "Share-of-total donut. 3 to 6 slices.",
    surface: {
      components: [
        { id: "root", component: "DonutChart", height: 220, data: sampleShare },
      ],
    },
  },
  {
    group: "data",
    name: "ScatterChart",
    blurb:
      "X/Y dots for correlation. Always pass xLabel and yLabel so people know what each axis is.",
    surface: {
      components: [
        {
          id: "root",
          component: "ScatterChart",
          height: 240,
          xLabel: "Months on platform",
          yLabel: "Weekly active hours",
          data: sampleScatter,
        },
      ],
    },
  },
  {
    group: "data",
    name: "DataTable",
    blurb: "Rows × columns with right-aligned numerics.",
    surface: {
      components: [
        {
          id: "root",
          component: "DataTable",
          columns: [
            { key: "name", label: "Customer", align: "left" },
            { key: "category", label: "Segment", align: "left" },
            { key: "value", label: "ARR", align: "right" },
            { key: "delta", label: "Δ", align: "right" },
          ],
          rows: sampleRows,
        },
      ],
    },
  },

  {
    group: "interactive",
    name: "Button",
    blurb: "Primary / secondary / ghost.",
    surface: {
      components: [
        { id: "root", component: "Row", gap: "sm", children: ["p", "s", "g"] },
        {
          id: "p",
          component: "Button",
          label: "Primary",
          variant: "primary",
          // A v0.9 `action` arrives as `onClick`.
          onClick: { event: { name: "noop" } },
        },
        {
          id: "s",
          component: "Button",
          label: "Secondary",
          variant: "secondary",
          // A v0.9 `action` arrives as `onClick`.
          onClick: { event: { name: "noop" } },
        },
        {
          id: "g",
          component: "Button",
          label: "Ghost",
          variant: "ghost",
          // A v0.9 `action` arrives as `onClick`.
          onClick: { event: { name: "noop" } },
        },
      ],
    },
  },
  {
    group: "interactive",
    name: "ChoiceChips",
    blurb: "Multi-select pills bound to a data path.",
    surface: {
      components: [
        {
          id: "root",
          component: "ChoiceChips",
          label: "Regions",
          options: [
            { label: "NA", value: "na" },
            { label: "EMEA", value: "emea" },
            { label: "APAC", value: "apac" },
            { label: "LATAM", value: "latam" },
          ],
          value: { "@path": "/regions" },
        },
      ],
      data: { regions: ["na", "emea"] },
    },
  },
];

const GROUPS: { key: Example["group"]; label: string }[] = [
  { key: "layout", label: "Layout" },
  { key: "content", label: "Content" },
  { key: "data", label: "Data viz" },
  { key: "interactive", label: "Interactive" },
];

export default function CatalogPage() {
  const [filter, setFilter] = useState<Example["group"] | "all">("all");
  const items =
    filter === "all" ? EXAMPLES : EXAMPLES.filter((e) => e.group === filter);

  return (
    <>
      <SiteNav active="catalog" />
      <PageHeader
        eyebrow="THE DESIGN SYSTEM"
        meta={
          <span className="pill">
            <span className="dot" /> {EXAMPLES.length} components
          </span>
        }
        title={
          <>
            Every component the agent <br className="hidden md:inline" />
            <span className="text-[var(--muted)]">is allowed to draw.</span>
          </>
        }
        subtitle="One catalog, one set of React renderers, one set of brand tokens. Both demos compose from this. The fixed dashboard via a pre-authored layout, the dynamic Q&A by inventing one per question."
      />

      <main className="flex-1 max-w-[1320px] mx-auto px-6 py-8 w-full">
        <div className="flex items-center gap-2 mb-6">
          <FilterBtn
            label="All"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {GROUPS.map((g) => (
            <FilterBtn
              key={g.key}
              label={g.label}
              active={filter === g.key}
              onClick={() => setFilter(g.key)}
            />
          ))}
          <span className="ml-auto mono text-[11px] text-[var(--muted-2)] uppercase tracking-wider">
            showing {items.length} / {EXAMPLES.length}
          </span>
        </div>

        <PreviewProvider>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {items.map((ex) => (
              <ShowcaseTile key={ex.name} example={ex} />
            ))}
          </div>
        </PreviewProvider>
      </main>

      <footer className="border-t border-[var(--line)] py-6 mt-10">
        <div className="max-w-[1320px] mx-auto px-6 text-xs text-[var(--muted)] flex items-center justify-between">
          <span>
            Definitions:{" "}
            <code className="mono px-1.5 py-0.5 rounded bg-[var(--surface-soft)] border border-[var(--line)] text-[11px]">
              web/src/a2ui/catalog/definitions.ts
            </code>{" "}
            · Renderers:{" "}
            <code className="mono px-1.5 py-0.5 rounded bg-[var(--surface-soft)] border border-[var(--line)] text-[11px]">
              web/src/a2ui/catalog/renderers.tsx
            </code>
          </span>
          <span className="mono">v0.2</span>
        </div>
      </footer>
    </>
  );
}

function FilterBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm mono transition ${
        active
          ? "bg-[var(--ink)] text-white border border-[var(--ink)]"
          : "bg-[var(--surface)] text-[var(--ink-2)] border border-[var(--line)] hover:border-[var(--ink-2)]"
      }`}
    >
      {label}
    </button>
  );
}

function ShowcaseTile({ example }: { example: Example }) {
  return (
    <div className="surface overflow-hidden flex flex-col">
      <header className="px-5 py-3 border-b border-[var(--line)] flex items-center justify-between">
        <div>
          <div className="font-semibold text-[15px] text-[var(--ink)]">
            {example.name}
          </div>
          <div className="text-[12.5px] text-[var(--muted)]">
            {example.blurb}
          </div>
        </div>
        <span className="mono text-[10.5px] uppercase tracking-wider text-[var(--muted-2)] px-2 py-0.5 rounded-full border border-[var(--line)]">
          {example.group}
        </span>
      </header>
      <div className="p-5 bg-[var(--surface-soft)] flex-1">
        <SurfacePreview name={example.name} surface={example.surface} />
      </div>
    </div>
  );
}

/* A CopilotKit of its own for the previews, apart from the app's agents:
 * each preview draws its surface straight from the operations, with no
 * model or runtime. A local agent takes the events a Button click sends, so
 * a click goes somewhere and does nothing. */
const PREVIEW_THREAD = "catalog-preview";
const PREVIEW_AGENT = "catalog-preview";
const PREVIEW_UI = { ui: catalog };

function createPreviewAgent() {
  return new HttpAgent({
    agentId: PREVIEW_AGENT,
    threadId: PREVIEW_THREAD,
    url: "/catalog/agent",
    fetch: async (_url, init) => {
      const { threadId, runId } = JSON.parse(String(init?.body)) as {
        threadId: string;
        runId: string;
      };
      const events = [
        { type: EventType.RUN_STARTED, threadId, runId },
        { type: EventType.RUN_FINISHED, threadId, runId },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
}

function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [agents] = useState(() => ({ [PREVIEW_AGENT]: createPreviewAgent() }));
  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={agents}
      enableInspector={false}
      generativeUI={PREVIEW_UI}
    >
      <InertChips />
      {children}
    </CopilotKitProvider>
  );
}

/* ChoiceChips calls `selectChip` on click. Here it does nothing. */
function InertChips() {
  useGenerativeUIFunction(catalog, "selectChip", () => undefined);
  return null;
}

function SurfacePreview({
  name,
  surface,
}: {
  name: string;
  surface: { components: unknown[]; data?: Record<string, unknown> };
}) {
  const runtime = useGenerativeUIRuntime();
  const surfaceId = `preview-${name}`;
  useLayoutEffect(() => {
    if (!runtime) return;
    const operations: Array<Record<string, unknown>> = [
      {
        version: "1.0",
        createSurface: { surfaceId, catalogId: CATALOG_ID },
      },
      {
        version: "1.0",
        updateComponents: { surfaceId, components: surface.components },
      },
    ];
    if (surface.data) {
      operations.push({
        version: "1.0",
        updateDataModel: { surfaceId, value: surface.data },
      });
    }
    runtime.manager.setActiveThread(PREVIEW_THREAD);
    runtime.manager.ingest(PREVIEW_THREAD, PREVIEW_AGENT, {
      surfaceId,
      // Each preview is its own target, so GenerativeUISurface finds it.
      target: surfaceId,
      catalogId: CATALOG_ID,
      operations: operations as never,
      status: "ready",
      rejected: [],
    });
  }, [runtime, surfaceId, surface]);
  return (
    <div className="a2ui-surface rounded-[var(--radius)]">
      <GenerativeUISurface id={surfaceId} ui={catalog} autoScroll={false} />
    </div>
  );
}
