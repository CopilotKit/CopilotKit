"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft } from "lucide-react";
import { useState } from "react";
import CardRenderer from "@/components/canvas/CardRenderer";
import { defaultDataFor } from "@/lib/canvas/state";
import type { Item, ProjectData } from "@/lib/canvas/types";
import { EmailDraftReview } from "./email-draft-review";
import { EnrichmentReview } from "./enrichment-review";
import { ChartsReview } from "./charts-review";
import { HitlReview } from "./hitl-review";
import { ProfilePopupReview } from "./profile-popup-review";
import { RenderToolsReview } from "./render-tools-review";
import { ToolCallsReview } from "./tool-calls-review";

// ---------------------------------------------------------------------------
// Sample items — used in tool previews
// ---------------------------------------------------------------------------

const sampleProject: Item = {
  id: "demo-project",
  type: "project",
  name: "Launch checklist",
  subtitle: "",
  data: {
    field1: "Q1 launch coordinating with Sales and Marketing.",
    field2: "Option A",
    field3: "2026-04-15",
    field4: [
      { id: "1", text: "Draft press release", done: true, proposed: false },
      { id: "2", text: "Brief design team", done: false, proposed: false },
      { id: "3", text: "Schedule launch demo", done: false, proposed: true },
    ],
    field4_id: 3,
  } as ProjectData,
};

const sampleEntity: Item = {
  id: "demo-entity",
  type: "entity",
  name: "Acme Inc.",
  subtitle: "",
  data: {
    field1: "Top customer in Q1.",
    field2: "Option A",
    field3: ["Tag 1", "Tag 3"],
    field3_options: ["Tag 1", "Tag 2", "Tag 3"],
  },
};

const sampleNote: Item = {
  id: "demo-note",
  type: "note",
  name: "Design principles",
  subtitle: "",
  data: { field1: "Default to clarity. Cut anything that isn't load-bearing." },
};

const sampleChart: Item = {
  id: "demo-chart",
  type: "chart",
  name: "Launch readiness",
  subtitle: "",
  data: {
    field1: [
      { id: "1", label: "Engineering", value: 80 },
      { id: "2", label: "Marketing", value: 55 },
      { id: "3", label: "Support", value: 30 },
    ],
    field1_id: 3,
  },
};

const SAMPLES_BY_TYPE = {
  project: sampleProject,
  entity: sampleEntity,
  note: sampleNote,
  chart: sampleChart,
};

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

type ToolCategory = "items" | "project" | "canvas";

interface ToolMeta {
  id: string;
  label: string;
  toolName: string;
  hook: "useFrontendTool";
  category: ToolCategory;
  description: string;
  parameters: ToolParam[];
  hasVisual: boolean;
  /** Bento grid column span (out of 4) */
  colSpan: 1 | 2 | 3 | 4;
}

const TOOL_REGISTRY: ToolMeta[] = [
  // ---- Item lifecycle ----
  {
    id: "createItem",
    label: "Create item",
    toolName: "createItem",
    hook: "useFrontendTool",
    category: "items",
    description:
      "Create a new canvas item (project, entity, note, or chart). The agent picks the type that best fits the user's request and the kit appends it to state.items.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "type",
        type: '"project" | "entity" | "note" | "chart"',
        required: true,
        description: "Which card kind to create.",
      },
      {
        name: "name",
        type: "string",
        required: false,
        description: "Optional title. Defaults to 'New {type}'.",
      },
    ],
  },
  {
    id: "setItemName",
    label: "Rename item",
    toolName: "setItemName",
    hook: "useFrontendTool",
    category: "items",
    description:
      "Set an existing item's title. Use the item id returned by createItem.",
    hasVisual: true,
    colSpan: 1,
    parameters: [
      {
        name: "itemId",
        type: "string",
        required: true,
        description: "ID of the item to rename.",
      },
      {
        name: "name",
        type: "string",
        required: true,
        description: "New title.",
      },
    ],
  },
  {
    id: "deleteItem",
    label: "Delete item",
    toolName: "deleteItem",
    hook: "useFrontendTool",
    category: "items",
    description:
      "Remove an item from the canvas by id. The agent should confirm with the user before calling this on items it didn't just create.",
    hasVisual: false,
    colSpan: 1,
    parameters: [
      {
        name: "itemId",
        type: "string",
        required: true,
        description: "ID of the item to remove.",
      },
    ],
  },

  // ---- Project card fields ----
  {
    id: "setProjectField1",
    label: "Project: description",
    toolName: "setProjectField1",
    hook: "useFrontendTool",
    category: "project",
    description:
      "Set project.data.field1 — the free-text description. Use this for the project's main details, scope, or rationale.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "itemId",
        type: "string",
        required: true,
        description: "ID of the project item.",
      },
      {
        name: "value",
        type: "string",
        required: true,
        description: "The description text.",
      },
    ],
  },
  {
    id: "setProjectField2",
    label: "Project: priority",
    toolName: "setProjectField2",
    hook: "useFrontendTool",
    category: "project",
    description:
      "Set project.data.field2 — the priority select. Option A = high, Option B = medium, Option C = low.",
    hasVisual: true,
    colSpan: 1,
    parameters: [
      {
        name: "itemId",
        type: "string",
        required: true,
        description: "ID of the project item.",
      },
      {
        name: "value",
        type: '"Option A" | "Option B" | "Option C"',
        required: true,
        description: "The priority bucket.",
      },
    ],
  },
  {
    id: "addProjectChecklistItem",
    label: "Project: checklist",
    toolName: "addProjectChecklistItem",
    hook: "useFrontendTool",
    category: "project",
    description:
      "Append a checklist item to project.data.field4. Items default to not-done; the user can check them off.",
    hasVisual: true,
    colSpan: 1,
    parameters: [
      {
        name: "itemId",
        type: "string",
        required: true,
        description: "ID of the project item.",
      },
      {
        name: "text",
        type: "string",
        required: false,
        description: "Checklist label. Defaults to 'New item'.",
      },
    ],
  },

  // ---- Canvas-level ----
  {
    id: "setGlobalTitle",
    label: "Canvas title",
    toolName: "setGlobalTitle",
    hook: "useFrontendTool",
    category: "canvas",
    description:
      "Set the top-level title shown above the cards. Use this when the user describes the canvas's purpose.",
    hasVisual: true,
    colSpan: 1,
    parameters: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "The new global title.",
      },
    ],
  },
  {
    id: "setGlobalDescription",
    label: "Canvas description",
    toolName: "setGlobalDescription",
    hook: "useFrontendTool",
    category: "canvas",
    description:
      "Set the subtext shown under the canvas title. Pair with setGlobalTitle to frame the workspace.",
    hasVisual: true,
    colSpan: 1,
    parameters: [
      {
        name: "description",
        type: "string",
        required: true,
        description: "The new global description.",
      },
    ],
  },
];

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  items: "Item lifecycle",
  project: "Project card fields",
  canvas: "Canvas header",
};

// ---------------------------------------------------------------------------
// Helper: how-it-works text
// ---------------------------------------------------------------------------

function howItWorks(tool: ToolMeta): string {
  if (tool.category === "items") {
    return "The agent emits a tool call with the parameters above. CopilotKit matches it to this frontend tool, the handler mutates state.items via agent.setState(), and the canvas re-renders. A short result string is returned to the agent.";
  }
  if (tool.category === "project") {
    return "The agent calls this tool with the target itemId and a new value. The handler patches that field on the project's data and the card re-renders in place. The result confirms which field changed.";
  }
  return "The agent calls this tool with the new title or description. The handler updates the corresponding key on agent state and the canvas header re-renders.";
}

// ---------------------------------------------------------------------------
// Bento card preview — compact preview for each tool in the grid
// ---------------------------------------------------------------------------

function CanvasHeaderPreview({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-white/40 p-4 dark:bg-white/5">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function CardFrame({
  item,
  className = "",
}: {
  item: Item;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-white/40 p-4 dark:bg-white/5 ${className}`}
    >
      <div className="text-sm font-medium">{item.name}</div>
      <div className="-mx-1 -mt-1 scale-[0.92] origin-top-left">
        <CardRenderer
          item={item}
          onUpdateData={() => {}}
          onToggleTag={() => {}}
        />
      </div>
    </div>
  );
}

function MiniTypeTile({ type }: { type: keyof typeof SAMPLES_BY_TYPE }) {
  const labels = {
    project: "Project",
    entity: "Entity",
    note: "Note",
    chart: "Chart",
  };
  return (
    <div className="rounded-md border bg-white/60 p-2 text-center dark:bg-white/5">
      <div className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
        {labels[type]}
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-muted" />
      <div className="mt-1 h-1.5 w-2/3 rounded-full bg-muted" />
    </div>
  );
}

function BentoPreview({ toolId }: { toolId: string }) {
  switch (toolId) {
    case "createItem":
      return (
        <div className="grid grid-cols-2 gap-2">
          {(["project", "entity", "note", "chart"] as const).map((t) => (
            <MiniTypeTile key={t} type={t} />
          ))}
        </div>
      );
    case "setItemName":
      return (
        <div className="rounded-lg border bg-white/40 p-3 dark:bg-white/5">
          <div className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-sm font-medium text-accent">
            Launch checklist
          </div>
          <p className="mt-2 text-[0.65rem] text-muted-foreground">
            ↑ editable title bound to item.name
          </p>
        </div>
      );
    case "setProjectField1": {
      const item: Item = {
        ...sampleProject,
        data: {
          ...(sampleProject.data as ProjectData),
          field4: [],
        },
      };
      return <CardFrame item={item} />;
    }
    case "setProjectField2": {
      const item: Item = {
        ...sampleProject,
        data: {
          ...(sampleProject.data as ProjectData),
          field2: "Option A",
          field4: [],
        },
      };
      return <CardFrame item={item} />;
    }
    case "addProjectChecklistItem":
      return <CardFrame item={sampleProject} />;
    case "setGlobalTitle":
      return (
        <CanvasHeaderPreview
          title="Hackathon Canvas"
          description="Ask the agent to create cards."
        />
      );
    case "setGlobalDescription":
      return (
        <CanvasHeaderPreview
          title="Hackathon Canvas"
          description="A working surface for the agent's plans."
        />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Full preview for detail view
// ---------------------------------------------------------------------------

function FullPreview({ toolId }: { toolId: string }) {
  switch (toolId) {
    case "createItem":
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(["project", "entity", "note", "chart"] as const).map((type) => (
            <div key={type}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {type[0].toUpperCase() + type.slice(1)} (empty default)
              </p>
              <CardFrame
                item={{
                  ...SAMPLES_BY_TYPE[type],
                  name: `New ${type}`,
                  data: defaultDataFor(type),
                }}
              />
            </div>
          ))}
        </div>
      );
    case "setProjectField2":
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(["Option A", "Option B", "Option C"] as const).map((opt) => (
            <div key={opt}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {opt}
              </p>
              <CardFrame
                item={{
                  ...sampleProject,
                  data: {
                    ...(sampleProject.data as ProjectData),
                    field2: opt,
                    field4: [],
                  },
                }}
              />
            </div>
          ))}
        </div>
      );
    case "addProjectChecklistItem":
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Empty
            </p>
            <CardFrame
              item={{
                ...sampleProject,
                data: { ...(sampleProject.data as ProjectData), field4: [] },
              }}
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              After 3 calls
            </p>
            <CardFrame item={sampleProject} />
          </div>
        </div>
      );
    default:
      return <BentoPreview toolId={toolId} />;
  }
}

// ---------------------------------------------------------------------------
// Atomic UI bits — local Badge replacement
// ---------------------------------------------------------------------------

function PillBadge({
  children,
  variant = "outline",
}: {
  children: React.ReactNode;
  variant?: "outline" | "secondary" | "default";
}) {
  const styles = {
    outline: "border bg-transparent text-muted-foreground",
    secondary: "border-transparent bg-muted text-foreground",
    default: "border-transparent bg-accent/15 text-accent",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bento card
// ---------------------------------------------------------------------------

function BentoCard({
  tool,
  onClick,
}: {
  tool: ToolMeta;
  onClick: () => void;
}) {
  const spanClass =
    tool.colSpan === 4
      ? "col-span-1 sm:col-span-2 lg:col-span-4"
      : tool.colSpan === 3
        ? "col-span-1 sm:col-span-2 lg:col-span-3"
        : tool.colSpan === 2
          ? "col-span-1 sm:col-span-2"
          : "col-span-1";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`${spanClass} group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left transition-all hover:border-foreground/20 hover:shadow-lg`}
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {tool.label}
          </h3>
          <code className="text-[11px] text-muted-foreground">
            {tool.toolName}
          </code>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <PillBadge variant="secondary">frontend</PillBadge>
          <PillBadge variant="outline">{CATEGORY_LABELS[tool.category]}</PillBadge>
        </div>
      </div>

      <p className="line-clamp-2 px-4 text-xs leading-relaxed text-muted-foreground">
        {tool.description}
      </p>

      {tool.hasVisual ? (
        <div className="mt-3 flex-1 overflow-hidden px-4 pb-4">
          <div className="pointer-events-none origin-top-left">
            <BentoPreview toolId={tool.id} />
          </div>
        </div>
      ) : (
        <div className="mt-3 flex-1 px-4 pb-4">
          <div className="space-y-1.5">
            {tool.parameters.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No parameters
              </p>
            ) : (
              tool.parameters.map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <code className="text-[11px] text-foreground">{p.name}</code>
                  <span className="text-[10px] text-muted-foreground">
                    {p.type}
                  </span>
                  {p.required && (
                    <PillBadge variant="default">req</PillBadge>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-card to-transparent pb-2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="rounded-full bg-foreground/10 px-3 py-1 text-[10px] font-medium text-foreground">
          View details
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function DetailView({
  tool,
  onBack,
}: {
  tool: ToolMeta;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft size={14} aria-hidden />
          All components
        </button>
        <h2 className="text-2xl font-bold text-foreground">{tool.label}</h2>
        <div className="mt-2 flex gap-2">
          <PillBadge variant="secondary">{tool.hook}</PillBadge>
          <PillBadge variant="outline">{CATEGORY_LABELS[tool.category]}</PillBadge>
        </div>
      </div>

      {tool.hasVisual && (
        <div className="rounded-xl border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            Preview
          </h3>
          <FullPreview toolId={tool.id} />
        </div>
      )}

      <div className="space-y-5 rounded-xl border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">Usage Guide</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Tool name</p>
            <p className="mt-1 font-mono text-sm text-foreground">
              {tool.toolName}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Registered via</p>
            <p className="mt-1 font-mono text-sm text-foreground">
              {tool.hook}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Agent description</p>
          <p className="mt-1 rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed text-foreground/80">
            {tool.description}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Parameters</p>
          {tool.parameters.length === 0 ? (
            <p className="mt-2 text-sm italic text-muted-foreground">
              No parameters
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Required</th>
                    <th className="pb-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tool.parameters.map((p) => (
                    <tr key={p.name} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-foreground">
                        {p.name}
                      </td>
                      <td className="py-2 pr-4 font-mono text-muted-foreground">
                        {p.type}
                      </td>
                      <td className="py-2 pr-4">
                        <PillBadge variant={p.required ? "default" : "outline"}>
                          {p.required ? "required" : "optional"}
                        </PillBadge>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {p.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs text-muted-foreground">
            How CopilotKit calls this tool
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">
            {howItWorks(tool)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category nav — sticky pills at the top of the review surface
// ---------------------------------------------------------------------------

function CategoryNav() {
  const items = [
    { id: "enrichment", label: "Enrichment stream" },
    { id: "charts", label: "Charts & visualizations" },
    { id: "hitl", label: "HITL surfaces" },
    { id: "profile-popup", label: "Profile popup" },
    { id: "email-draft", label: "Email draft" },
    { id: "render-tools", label: "Render tools" },
    { id: "tool-calls", label: "Tool calls" },
  ];
  return (
    <nav
      aria-label="Component categories"
      className="sticky top-0 z-10 -mx-2 flex flex-wrap gap-2 rounded-xl border bg-card/95 px-2 py-2 shadow-sm backdrop-blur"
    >
      {items.map((it) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-secondary/40 hover:bg-secondary/10 hover:text-secondary"
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ComponentsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTool = TOOL_REGISTRY.find((t) => t.id === selectedId);

  const categories: ToolCategory[] = ["items", "project", "canvas"];

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to canvas
        </Link>

        <div className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-accent">
            CopilotKit components
          </p>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            Generative UI surfaces
          </h1>
          <p className="mt-2 text-muted-foreground">
            {selectedTool
              ? "Detailed usage guide and preview."
              : "Visual design and state shape for every CopilotKit-driven component in the lead-triage studio. Streaming, inline-in-chat, and canvas-mounted surfaces."}
          </p>
        </div>

        {selectedTool ? (
          <DetailView
            tool={selectedTool}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="space-y-16">
            <CategoryNav />

            <div id="enrichment">
              <EnrichmentReview />
            </div>

            <div id="charts">
              <ChartsReview />
            </div>

            <div id="hitl">
              <HitlReview />
            </div>

            <div id="profile-popup">
              <ProfilePopupReview />
            </div>

            <div id="email-draft">
              <EmailDraftReview />
            </div>

            <div id="render-tools">
              <RenderToolsReview />
            </div>

            <div id="tool-calls">
              <ToolCallsReview />
            </div>

            <div>
              <div className="mb-6 border-t pt-8">
                <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Legacy · canvas v1
                </p>
                <h2 className="text-xl font-bold text-foreground">
                  Frontend tools (item canvas)
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The original card-based canvas. Kept for reference while the
                  lead-triage surfaces above land.
                </p>
              </div>
              <div className="space-y-10">
                {categories.map((cat) => {
                  const tools = TOOL_REGISTRY.filter((t) => t.category === cat);
                  if (tools.length === 0) return null;
                  return (
                    <div key={cat}>
                      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {CATEGORY_LABELS[cat]}
                      </h3>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {tools.map((tool) => (
                          <BentoCard
                            key={tool.id}
                            tool={tool}
                            onClick={() => setSelectedId(tool.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
