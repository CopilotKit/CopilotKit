"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileCode2,
  ListChecks,
  Search,
} from "lucide-react";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import { useComponent } from "@copilotkit/react-core/v2";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CONTROL_ROOM_AGENT_NAME } from "@/hooks/use-control-room-state";
import { cn } from "@/lib/utils";

const metricSchema = z.object({
  label: z.string().describe("Short metric label."),
  value: z.string().describe("Metric value to display."),
  detail: z.string().optional().describe("Optional supporting text."),
  tone: z
    .enum(["default", "success", "warning", "danger"])
    .optional()
    .describe("Visual emphasis for the metric."),
});

const stagePointSchema = z.object({
  stage: z.string().describe("Stage label, for example Plan or Verify."),
  tests: z.number().describe("Number of test or verification checks completed."),
  files: z.number().describe("Number of relevant files inspected or changed."),
  approvals: z.number().describe("Number of Harness approvals involved."),
});

const areaPointSchema = z.object({
  stage: z.string().describe("Stage label, for example Plan or Verify."),
  confidence: z
    .number()
    .describe("Confidence percentage from 0 to 100 for the fix."),
  failures: z.number().describe("Remaining failing checks at this stage."),
});

const stackedAreaPointSchema = z.object({
  stage: z.string().describe("Stage label, for example Inspect or Verify."),
  toolCalls: z.number().describe("Tool calls completed in this stage."),
  evidence: z.number().describe("Evidence artifacts collected in this stage."),
  approvals: z.number().describe("Approvals requested in this stage."),
});

const usageSliceSchema = z.object({
  name: z.string().describe("Tool or signal name."),
  value: z.number().describe("Count or percentage value for this slice."),
});

const capabilityScoreSchema = z.object({
  capability: z.string().describe("Harness capability label."),
  score: z.number().describe("Score from 0 to 100."),
});

const radialMetricSchema = z.object({
  label: z.string().describe("Short progress label."),
  value: z.number().describe("Progress value from 0 to 100."),
  detail: z.string().optional().describe("Optional supporting text."),
});

const runHealthRowSchema = z.object({
  check: z.string().describe("Check name, for example Tests or Coverage."),
  status: z.enum(["pass", "running", "blocked", "fail"]).describe("Check status."),
  progress: z.number().describe("Progress percentage from 0 to 100."),
  detail: z.string().describe("Short detail for the row."),
});

const timelineEventSchema = z.object({
  label: z.string().describe("Short event label."),
  date: z.string().describe("ISO date such as 2026-06-03."),
  detail: z.string().optional().describe("Optional short description."),
  tone: z
    .enum(["default", "success", "warning", "danger"])
    .optional()
    .describe("Visual emphasis for this event."),
});

const fileImpactSchema = z.object({
  path: z.string().describe("File path shown to the audience."),
  risk: z.enum(["low", "medium", "high"]).describe("Risk level for this file."),
  change: z.string().describe("Short description of the read or patch."),
});

const HarnessSummaryProps = z.object({
  title: z.string().describe("Short title for the summary card."),
  status: z.string().describe("One-sentence current status."),
  metrics: z
    .array(metricSchema)
    .min(2)
    .max(6)
    .describe("Metrics such as mode, todos, files, approvals, tests, memory."),
});

const RepairTrendChartProps = z.object({
  title: z.string().describe("Short chart title."),
  summary: z.string().describe("One-sentence explanation of the chart."),
  data: z
    .array(stagePointSchema)
    .min(2)
    .max(8)
    .describe("Stage-by-stage values for tests, files, and approvals."),
});

const RepairCalendarProps = z.object({
  title: z.string().describe("Short calendar title."),
  summary: z.string().describe("Why this calendar is useful in the demo."),
  events: z
    .array(timelineEventSchema)
    .min(1)
    .max(8)
    .describe("Dated presenter timeline or approval window events."),
});

const FileImpactMapProps = z.object({
  title: z.string().describe("Short title for the impact map."),
  summary: z.string().describe("One-sentence file impact summary."),
  files: z
    .array(fileImpactSchema)
    .min(1)
    .max(6)
    .describe("Files inspected or changed by the Harness run."),
});

const CoverageAreaChartProps = z.object({
  title: z.string().describe("Short area chart title."),
  summary: z.string().describe("One-sentence explanation of the trend."),
  data: z
    .array(areaPointSchema)
    .min(2)
    .max(8)
    .describe("Stage-by-stage confidence and failure counts."),
});

const WorkstreamStackedAreaProps = z.object({
  title: z.string().describe("Short stacked area chart title."),
  summary: z.string().describe("One-sentence explanation of the activity mix."),
  data: z
    .array(stackedAreaPointSchema)
    .min(2)
    .max(8)
    .describe("Stage-by-stage activity mix for tool calls, evidence, and approvals."),
});

const ToolUsageDonutProps = z.object({
  title: z.string().describe("Short donut chart title."),
  summary: z.string().describe("One-sentence explanation of tool usage."),
  data: z
    .array(usageSliceSchema)
    .min(2)
    .max(8)
    .describe("Tool usage slices such as file reads, shell runs, approvals, memory."),
});

const CapabilityRadarProps = z.object({
  title: z.string().describe("Short radar chart title."),
  summary: z.string().describe("One-sentence explanation of capability coverage."),
  data: z
    .array(capabilityScoreSchema)
    .min(3)
    .max(8)
    .describe("Harness capability scores for the radar chart."),
});

const ApprovalRadialProps = z.object({
  title: z.string().describe("Short radial progress title."),
  summary: z.string().describe("One-sentence explanation of approval readiness."),
  metrics: z
    .array(radialMetricSchema)
    .min(1)
    .max(4)
    .describe("Radial progress metrics for approval readiness or verification."),
});

const RunHealthTableProps = z.object({
  title: z.string().describe("Short table title."),
  summary: z.string().describe("One-sentence explanation of run health."),
  rows: z
    .array(runHealthRowSchema)
    .min(2)
    .max(8)
    .describe("Rows for tests, coverage, typecheck, approvals, memory, and files."),
});

const approvalCheckSchema = z.object({
  label: z.string().describe("Short approval readiness check."),
  complete: z.boolean().describe("Whether the check is complete."),
});

const ApprovalReadinessFormProps = z.object({
  title: z.string().describe("Short form title."),
  summary: z.string().describe("Why operator approval is needed."),
  command: z.string().describe("Command or action being approved."),
  risk: z.enum(["low", "medium", "high"]).describe("Approval risk level."),
  checks: z
    .array(approvalCheckSchema)
    .min(2)
    .max(5)
    .describe("Readiness checks before approving the action."),
});

const HandoffFormProps = z.object({
  title: z.string().describe("Short handoff title."),
  summary: z.string().describe("One-sentence handoff summary."),
  owner: z.string().describe("Suggested next owner or audience."),
  notes: z.string().describe("Concise post-mortem notes."),
  followups: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe("Follow-up items captured during review."),
});

export const GENERATIVE_UI_CATALOG = [
  {
    id: "summary",
    name: "showHarnessSummary",
    label: "Harness Summary",
    category: "Status",
    description:
      "Summarizes mode, todos, approvals, files, tests, and memory.",
  },
  {
    id: "trend",
    name: "showRepairTrendChart",
    label: "Repair Trend Chart",
    category: "Charts",
    description:
      "Shows repair progress across stages, tests, files, and approvals.",
  },
  {
    id: "coverage",
    name: "showCoverageAreaChart",
    label: "Coverage Area Chart",
    category: "Charts",
    description:
      "Shows confidence, failures, and verification momentum.",
  },
  {
    id: "workstream",
    name: "showWorkstreamStackedArea",
    label: "Workstream Stacked Area",
    category: "Charts",
    description:
      "Shows tool calls, evidence, and approvals by stage.",
  },
  {
    id: "usage",
    name: "showToolUsageDonut",
    label: "Tool Usage Donut",
    category: "Charts",
    description:
      "Shows the mix of file, shell, approval, and memory activity.",
  },
  {
    id: "radar",
    name: "showCapabilityRadar",
    label: "Capability Radar",
    category: "Charts",
    description:
      "Shows Harness capability coverage across the run.",
  },
  {
    id: "radial",
    name: "showApprovalRadial",
    label: "Approval Radial",
    category: "Charts",
    description:
      "Shows approval readiness or verification confidence.",
  },
  {
    id: "calendar",
    name: "showRepairCalendar",
    label: "Repair Calendar",
    category: "Schedule",
    description:
      "Shows presenter timelines, approval windows, and verification dates.",
  },
  {
    id: "runHealth",
    name: "showRunHealthTable",
    label: "Run Health Table",
    category: "Tables",
    description:
      "Shows tests, coverage, approvals, and memory with progress.",
  },
  {
    id: "files",
    name: "showFileImpactMap",
    label: "File Impact Map",
    category: "Files",
    description:
      "Shows files the Harness inspected or changed.",
  },
  {
    id: "approval",
    name: "showApprovalReadinessForm",
    label: "Approval Form",
    category: "Forms",
    description:
      "Shows an approval checklist before risky Harness actions.",
  },
  {
    id: "handoff",
    name: "showHandoffForm",
    label: "Handoff Form",
    category: "Forms",
    description:
      "Shows memory, owner, notes, and follow-up items.",
  },
] as const;

type CatalogItemId = (typeof GENERATIVE_UI_CATALOG)[number]["id"];
type CatalogItem = (typeof GENERATIVE_UI_CATALOG)[number];
type CatalogState = Record<CatalogItemId, boolean>;

const DEFAULT_CATALOG_STATE: CatalogState = {
  summary: true,
  trend: true,
  coverage: true,
  workstream: true,
  usage: true,
  radar: true,
  radial: true,
  calendar: true,
  files: true,
  runHealth: true,
  approval: true,
  handoff: true,
};

type GenerativeUICatalogContextValue = {
  enabled: CatalogState;
  enabledItems: CatalogItem[];
  setEnabled: (id: CatalogItemId, value: boolean) => void;
  enableAll: () => void;
  disableAll: () => void;
};

const GenerativeUICatalogContext =
  createContext<GenerativeUICatalogContextValue | null>(null);

export function GenerativeUICatalogProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [enabled, setEnabledState] =
    useState<CatalogState>(DEFAULT_CATALOG_STATE);

  const value = useMemo<GenerativeUICatalogContextValue>(
    () => ({
      enabled,
      enabledItems: GENERATIVE_UI_CATALOG.filter((item) => enabled[item.id]),
      setEnabled: (id, nextValue) =>
        setEnabledState((current) => ({ ...current, [id]: nextValue })),
      enableAll: () => setEnabledState(DEFAULT_CATALOG_STATE),
      disableAll: () =>
        setEnabledState({
          summary: false,
          trend: false,
          coverage: false,
          workstream: false,
          usage: false,
          radar: false,
          radial: false,
          calendar: false,
          files: false,
          runHealth: false,
          approval: false,
          handoff: false,
        }),
    }),
    [enabled],
  );

  return (
    <GenerativeUICatalogContext.Provider value={value}>
      {children}
    </GenerativeUICatalogContext.Provider>
  );
}

export function useGenerativeUICatalog() {
  const context = useContext(GenerativeUICatalogContext);
  if (!context) {
    throw new Error(
      "useGenerativeUICatalog must be used inside GenerativeUICatalogProvider",
    );
  }
  return context;
}

export function GenerativeUIRegistry() {
  const { enabled } = useGenerativeUICatalog();

  return (
    <>
      {enabled.summary ? <HarnessSummaryRegistration /> : null}
      {enabled.trend ? <RepairTrendChartRegistration /> : null}
      {enabled.coverage ? <CoverageAreaChartRegistration /> : null}
      {enabled.workstream ? <WorkstreamStackedAreaRegistration /> : null}
      {enabled.usage ? <ToolUsageDonutRegistration /> : null}
      {enabled.radar ? <CapabilityRadarRegistration /> : null}
      {enabled.radial ? <ApprovalRadialRegistration /> : null}
      {enabled.calendar ? <RepairCalendarRegistration /> : null}
      {enabled.files ? <FileImpactMapRegistration /> : null}
      {enabled.runHealth ? <RunHealthTableRegistration /> : null}
      {enabled.approval ? <ApprovalReadinessFormRegistration /> : null}
      {enabled.handoff ? <HandoffFormRegistration /> : null}
    </>
  );
}

export function GenerativeUICatalogPanel({
  className,
}: {
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const { enabled, enabledItems, setEnabled, enableAll, disableAll } =
    useGenerativeUICatalog();
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return GENERATIVE_UI_CATALOG;
    return GENERATIVE_UI_CATALOG.filter((item) =>
      `${item.label} ${item.name} ${item.category} ${item.description}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="border-b px-5 py-4 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              Generative UI
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Enable the components the Harness agent can render in chat.
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {enabledItems.length} enabled
          </Badge>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/25 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search charts, forms, calendar..."
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={enableAll}>
            Enable all
          </Button>
          <Button type="button" variant="outline" onClick={disableAll}>
            Disable all
          </Button>
        </div>
        <Separator />
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <CatalogItemRow
              key={item.id}
              item={item}
              enabled={enabled[item.id]}
              onEnabledChange={(checked) => setEnabled(item.id, checked)}
            />
          ))}
          {filteredItems.length === 0 ? (
            <div className="rounded-2xl border bg-background p-5 text-sm text-muted-foreground">
              No components match that search.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CatalogItemRow({
  item,
  enabled,
  onEnabledChange,
}: {
  item: CatalogItem;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <label className="grid min-w-0 cursor-pointer gap-4 overflow-hidden rounded-3xl border bg-background p-4 shadow-sm transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={enabled}
          onCheckedChange={(checked) => onEnabledChange(checked === true)}
          className="mt-1"
        />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {item.label}
            <Badge variant="secondary">{item.category}</Badge>
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? "enabled" : "hidden"}
            </Badge>
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {item.name}
          </span>
        </span>
      </div>
      <CatalogPreview itemId={item.id} />
    </label>
  );
}

function CatalogPreviewFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col items-center overflow-hidden rounded-2xl border bg-muted/20 p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CatalogPreview({ itemId }: { itemId: CatalogItemId }) {
  switch (itemId) {
    case "summary":
      return (
        <HarnessSummaryPreview />
      );
    case "trend":
      return (
        <RepairTrendPreview />
      );
    case "coverage":
      return (
        <CoverageAreaPreview />
      );
    case "workstream":
      return (
        <WorkstreamStackedAreaPreview />
      );
    case "usage":
      return (
        <ToolUsageDonutPreview />
      );
    case "radar":
      return (
        <CapabilityRadarPreview />
      );
    case "radial":
      return (
        <ApprovalRadialPreview />
      );
    case "calendar":
      return (
        <CalendarPreview />
      );
    case "files":
      return (
        <FileImpactPreview />
      );
    case "runHealth":
      return (
        <RunHealthTablePreview />
      );
    case "approval":
      return (
        <ApprovalFormPreview />
      );
    case "handoff":
      return (
        <HandoffFormPreview />
      );
  }
}

function HarnessSummaryRegistration() {
  useComponent({
    name: "showHarnessSummary",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: HarnessSummaryProps,
    description:
      "Use this for concise stage status summaries. Prefer it after planning, after a patch, after a test run, and during the final review. Populate metrics with Harness-specific values such as mode, todos, files, approvals, last test, and memory.",
    render: HarnessSummaryCard,
  });
  return null;
}

function RepairTrendChartRegistration() {
  useComponent({
    name: "showRepairTrendChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: RepairTrendChartProps,
    description:
      "Use this when the audience should see progress over a Harness run. Prefer it after tests or coverage. Use labels such as Plan, Inspect, Patch, Test, Verify, and Handoff.",
    render: RepairTrendChart,
  });
  return null;
}

function CoverageAreaChartRegistration() {
  useComponent({
    name: "showCoverageAreaChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: CoverageAreaChartProps,
    description:
      "Use this area chart when the audience should see confidence rising or failures dropping across Plan, Inspect, Fix, Run, and Verify. Prefer it during verification and final review.",
    render: CoverageAreaChart,
  });
  return null;
}

function WorkstreamStackedAreaRegistration() {
  useComponent({
    name: "showWorkstreamStackedArea",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: WorkstreamStackedAreaProps,
    description:
      "Use this stacked area chart when the audience should see the mix of tool calls, evidence, and approvals across the guided repair stages.",
    render: WorkstreamStackedArea,
  });
  return null;
}

function ToolUsageDonutRegistration() {
  useComponent({
    name: "showToolUsageDonut",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: ToolUsageDonutProps,
    description:
      "Use this donut chart when the audience should understand which Harness capabilities dominated the run: file reads, shell tools, approvals, memory, or todos.",
    render: ToolUsageDonut,
  });
  return null;
}

function CapabilityRadarRegistration() {
  useComponent({
    name: "showCapabilityRadar",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: CapabilityRadarProps,
    description:
      "Use this radar chart for a capability-tour moment: planning, todos, memory, tools, approvals, files, and verification.",
    render: CapabilityRadar,
  });
  return null;
}

function ApprovalRadialRegistration() {
  useComponent({
    name: "showApprovalRadial",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: ApprovalRadialProps,
    description:
      "Use this radial chart for compact progress moments such as approval readiness, verification confidence, or stage completion.",
    render: ApprovalRadial,
  });
  return null;
}

function RepairCalendarRegistration() {
  useComponent({
    name: "showRepairCalendar",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: RepairCalendarProps,
    description:
      "Use this to show a dated presenter timeline, approval window, or verification handoff schedule. Choose realistic ISO dates and keep labels short enough for a stage demo.",
    render: RepairCalendar,
  });
  return null;
}

function ApprovalReadinessFormRegistration() {
  useComponent({
    name: "showApprovalReadinessForm",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: ApprovalReadinessFormProps,
    description:
      "Use this form-style component immediately before approval-gated shell or file actions. It should show the command, risk level, and readiness checks for the presenter.",
    render: ApprovalReadinessForm,
  });
  return null;
}

function HandoffFormRegistration() {
  useComponent({
    name: "showHandoffForm",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: HandoffFormProps,
    description:
      "Use this form-style component during the Review step after saving memory. It should summarize owner, notes, and follow-up items for handoff.",
    render: HandoffForm,
  });
  return null;
}

function FileImpactMapRegistration() {
  useComponent({
    name: "showFileImpactMap",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: FileImpactMapProps,
    description:
      "Use this after inspecting or patching files. Show only top-level fixture paths such as calculator.ts and calculator.test.ts, risk level, and why each file matters.",
    render: FileImpactMap,
  });
  return null;
}

function RunHealthTableRegistration() {
  useComponent({
    name: "showRunHealthTable",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: RunHealthTableProps,
    description:
      "Use this table when the audience should see run health as rows: tests, coverage, typecheck, approvals, files, and memory with status and progress.",
    render: RunHealthTable,
  });
  return null;
}

function HarnessSummaryCard({
  title,
  status,
  metrics,
}: z.infer<typeof HarnessSummaryProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          Harness summary
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{status}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={`${metric.label}-${metric.value}`}
            className={cn(
              "rounded-2xl border bg-muted/30 p-3",
              metric.tone === "success" && "border-emerald-200 bg-emerald-50",
              metric.tone === "warning" && "border-amber-200 bg-amber-50",
              metric.tone === "danger" && "border-red-200 bg-red-50",
            )}
          >
            <div className="text-xs text-muted-foreground">{metric.label}</div>
            <div className="mt-1 text-xl font-semibold">{metric.value}</div>
            {metric.detail ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {metric.detail}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const repairTrendConfig = {
  tests: { label: "Tests", color: "var(--chart-2)" },
  files: { label: "Files", color: "var(--chart-3)" },
  approvals: { label: "Approvals", color: "var(--chart-4)" },
} satisfies ChartConfig;

function RepairTrendChart({
  title,
  summary,
  data,
}: z.infer<typeof RepairTrendChartProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          chart
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={repairTrendConfig} className="min-h-[260px]">
          <ComposedChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="stage" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="files"
              fill="var(--color-files)"
              radius={[6, 6, 0, 0]}
            />
            <Line
              type="monotone"
              dataKey="tests"
              stroke="var(--color-tests)"
              strokeWidth={3}
              dot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="approvals"
              stroke="var(--color-approvals)"
              strokeWidth={3}
              dot={{ r: 4 }}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const coverageAreaConfig = {
  confidence: { label: "Confidence", color: "var(--chart-2)" },
  failures: { label: "Failures", color: "var(--chart-4)" },
} satisfies ChartConfig;

function CoverageAreaChart({
  title,
  summary,
  data,
}: z.infer<typeof CoverageAreaChartProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          area chart
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={coverageAreaConfig} className="min-h-[260px]">
          <AreaChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="stage" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="confidence"
              type="natural"
              fill="var(--color-confidence)"
              fillOpacity={0.28}
              stroke="var(--color-confidence)"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="failures"
              stroke="var(--color-failures)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const workstreamStackConfig = {
  toolCalls: { label: "Tool calls", color: "var(--chart-2)" },
  evidence: { label: "Evidence", color: "var(--chart-3)" },
  approvals: { label: "Approvals", color: "var(--chart-4)" },
} satisfies ChartConfig;

function WorkstreamStackedArea({
  title,
  summary,
  data,
}: z.infer<typeof WorkstreamStackedAreaProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          stacked area
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={workstreamStackConfig} className="min-h-[260px]">
          <AreaChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="stage" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="toolCalls"
              stackId="run"
              type="natural"
              fill="var(--color-toolCalls)"
              fillOpacity={0.7}
              stroke="var(--color-toolCalls)"
            />
            <Area
              dataKey="evidence"
              stackId="run"
              type="natural"
              fill="var(--color-evidence)"
              fillOpacity={0.55}
              stroke="var(--color-evidence)"
            />
            <Area
              dataKey="approvals"
              stackId="run"
              type="natural"
              fill="var(--color-approvals)"
              fillOpacity={0.4}
              stroke="var(--color-approvals)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const toolUsageConfig = {
  value: { label: "Usage" },
  files: { label: "Files", color: "var(--chart-2)" },
  shell: { label: "Shell", color: "var(--chart-3)" },
  approvals: { label: "Approvals", color: "var(--chart-4)" },
  memory: { label: "Memory", color: "var(--chart-5)" },
  todos: { label: "Todos", color: "var(--chart-1)" },
} satisfies ChartConfig;

const donutColors = [
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-1)",
];

function ToolUsageDonut({
  title,
  summary,
  data,
}: z.infer<typeof ToolUsageDonutProps>) {
  const chartData = data.map((item, index) => ({
    ...item,
    fill: donutColors[index % donutColors.length],
  }));
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          donut chart
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[240px_1fr]">
        <ChartContainer config={toolUsageConfig} className="mx-auto aspect-square h-[220px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={86}
              strokeWidth={4}
            />
          </PieChart>
        </ChartContainer>
        <div className="grid content-center gap-2">
          {chartData.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-2xl border bg-muted/30 p-3 text-sm"
            >
              <span className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ background: item.fill }}
                />
                {item.name}
              </span>
              <span className="font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const radarConfig = {
  score: { label: "Score", color: "var(--chart-2)" },
} satisfies ChartConfig;

function CapabilityRadar({
  title,
  summary,
  data,
}: z.infer<typeof CapabilityRadarProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          radar chart
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={radarConfig} className="mx-auto aspect-square max-h-[320px]">
          <RadarChart data={data}>
            <ChartTooltip content={<ChartTooltipContent />} />
            <PolarAngleAxis dataKey="capability" />
            <PolarGrid />
            <Radar
              dataKey="score"
              fill="var(--color-score)"
              fillOpacity={0.28}
              stroke="var(--color-score)"
              strokeWidth={2}
            />
          </RadarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const radialConfig = {
  value: { label: "Value", color: "var(--chart-2)" },
} satisfies ChartConfig;

function ApprovalRadial({
  title,
  summary,
  metrics,
}: z.infer<typeof ApprovalRadialProps>) {
  const data = metrics.map((metric, index) => ({
    ...metric,
    fill: donutColors[index % donutColors.length],
  }));
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          radial chart
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[220px_1fr]">
        <ChartContainer config={radialConfig} className="mx-auto aspect-square h-[220px]">
          <RadialBarChart
            data={data}
            innerRadius={36}
            outerRadius={94}
            startAngle={90}
            endAngle={-270}
          >
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <RadialBar dataKey="value" background cornerRadius={12} />
          </RadialBarChart>
        </ChartContainer>
        <div className="grid content-center gap-3">
          {data.map((metric) => (
            <div key={metric.label} className="grid gap-1">
              <div className="flex justify-between gap-3 text-sm">
                <span>{metric.label}</span>
                <span className="font-medium">{metric.value}%</span>
              </div>
              <Progress value={metric.value} />
              {metric.detail ? (
                <div className="text-xs text-muted-foreground">
                  {metric.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RepairCalendar({
  title,
  summary,
  events,
}: z.infer<typeof RepairCalendarProps>) {
  const selectedDates = events
    .map((event) => new Date(`${event.date}T12:00:00`))
    .filter((date) => !Number.isNaN(date.getTime()));
  const firstDate = selectedDates[0] ?? new Date();

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          calendar
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="rounded-2xl border bg-background">
          <Calendar
            mode="multiple"
            month={firstDate}
            selected={selectedDates}
            className="rounded-2xl"
          />
        </div>
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={`${event.date}-${event.label}`}
              className="rounded-2xl border bg-muted/30 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{event.label}</div>
                <ToneBadge tone={event.tone}>{event.date}</ToneBadge>
              </div>
              {event.detail ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  {event.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovalReadinessForm({
  title,
  summary,
  command,
  risk,
  checks,
}: z.infer<typeof ApprovalReadinessFormProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          Approval form
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
          <Input readOnly value={command} aria-label="Approval command" />
          <Select value={risk} disabled>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low risk</SelectItem>
              <SelectItem value="medium">Medium risk</SelectItem>
              <SelectItem value="high">High risk</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          {checks.map((check) => (
            <div
              key={check.label}
              className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-3"
            >
              <span className="text-sm">{check.label}</span>
              <Switch checked={check.complete} disabled />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HandoffForm({
  title,
  summary,
  owner,
  notes,
  followups,
}: z.infer<typeof HandoffFormProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          Handoff form
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Input readOnly value={owner} aria-label="Handoff owner" />
        <Textarea readOnly value={notes} aria-label="Handoff notes" />
        <div className="grid gap-2">
          {followups.map((followup) => (
            <div
              key={followup}
              className="flex items-center gap-2 rounded-2xl border bg-muted/30 p-3 text-sm"
            >
              <ListChecks className="size-4 text-primary" />
              {followup}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FileImpactMap({
  title,
  summary,
  files,
}: z.infer<typeof FileImpactMapProps>) {
  const data = files.map((file) => ({
    path: file.path,
    impact: file.risk === "high" ? 3 : file.risk === "medium" ? 2 : 1,
  }));
  const config = {
    impact: { label: "Impact", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          File impact
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChartContainer config={config} className="min-h-[180px]">
          <BarChart data={data} layout="vertical" margin={{ left: 16, right: 8 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" hide domain={[0, 3]} />
            <YAxis
              dataKey="path"
              type="category"
              tickLine={false}
              axisLine={false}
              width={120}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="impact" fill="var(--color-impact)" radius={6} />
          </BarChart>
        </ChartContainer>
        <div className="grid gap-2">
          {files.map((file) => (
            <div
              key={file.path}
              className="grid gap-2 rounded-2xl border bg-muted/30 p-3 sm:grid-cols-[1fr_auto]"
            >
              <div>
                <div className="font-mono text-sm font-medium">{file.path}</div>
                <div className="text-sm text-muted-foreground">
                  {file.change}
                </div>
              </div>
              <ToneBadge
                tone={
                  file.risk === "high"
                    ? "danger"
                    : file.risk === "medium"
                      ? "warning"
                      : "success"
                }
              >
                {file.risk}
              </ToneBadge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RunHealthTable({
  title,
  summary,
  rows,
}: z.infer<typeof RunHealthTableProps>) {
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          run table
        </Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[180px]">Progress</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.check}>
                <TableCell className="font-medium">{row.check}</TableCell>
                <TableCell>
                  <ToneBadge tone={statusTone(row.status)}>
                    {row.status}
                  </ToneBadge>
                </TableCell>
                <TableCell>
                  <Progress value={row.progress} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.detail}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function HarnessSummaryPreview() {
  return (
    <CatalogPreviewFrame className="grid grid-cols-3 gap-2">
      {[
        ["Mode", "Plan"],
        ["Todos", "3"],
        ["Files", "2"],
      ].map(([label, value]) => (
        <div key={label} className="rounded-xl border bg-background p-2">
          <div className="text-[10px] text-muted-foreground">{label}</div>
          <div className="text-sm font-semibold">{value}</div>
        </div>
      ))}
    </CatalogPreviewFrame>
  );
}

function RepairTrendPreview() {
  const data = [
    { stage: "Plan", tests: 0, files: 0, approvals: 0 },
    { stage: "Fix", tests: 1, files: 2, approvals: 1 },
    { stage: "Verify", tests: 2, files: 2, approvals: 1 },
  ];

  return (
    <CatalogPreviewFrame className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium">
          <ChartNoAxesCombined className="size-4 text-primary" />
          Repair progress
        </span>
        <span className="text-[10px] text-muted-foreground">Plan to Verify</span>
      </div>
      <ChartContainer config={repairTrendConfig} className="h-[104px] w-full min-w-0 aspect-auto">
        <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="stage"
            axisLine={false}
            tickLine={false}
            tickMargin={4}
            tick={{ fontSize: 10 }}
          />
          <YAxis hide domain={[0, 2]} />
          <Bar
            dataKey="files"
            fill="var(--color-files)"
            radius={[5, 5, 0, 0]}
            barSize={24}
          />
          <Line
            type="monotone"
            dataKey="tests"
            stroke="var(--color-tests)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="approvals"
            stroke="var(--color-approvals)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ChartContainer>
      <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
        <LegendDot color="var(--chart-2)" label="Tests" />
        <LegendDot color="var(--chart-3)" label="Files" />
        <LegendDot color="var(--chart-4)" label="Approvals" />
      </div>
    </CatalogPreviewFrame>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function CoverageAreaPreview() {
  return (
    <ChartContainer
      config={coverageAreaConfig}
      className="h-[120px] w-full rounded-2xl border bg-muted/20 p-2 aspect-auto"
    >
      <AreaChart
        data={[
          { stage: "Plan", confidence: 35, failures: 3 },
          { stage: "Fix", confidence: 70, failures: 1 },
          { stage: "Verify", confidence: 94, failures: 0 },
        ]}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="stage" hide />
        <YAxis hide />
        <Area
          dataKey="confidence"
          type="natural"
          fill="var(--color-confidence)"
          fillOpacity={0.35}
          stroke="var(--color-confidence)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function WorkstreamStackedAreaPreview() {
  return (
    <ChartContainer
      config={workstreamStackConfig}
      className="h-[120px] w-full rounded-2xl border bg-muted/20 p-2 aspect-auto"
    >
      <AreaChart
        data={[
          { stage: "Plan", toolCalls: 1, evidence: 1, approvals: 0 },
          { stage: "Fix", toolCalls: 3, evidence: 2, approvals: 1 },
          { stage: "Verify", toolCalls: 2, evidence: 3, approvals: 1 },
        ]}
      >
        <XAxis dataKey="stage" hide />
        <YAxis hide />
        <Area
          dataKey="toolCalls"
          stackId="run"
          type="natural"
          fill="var(--color-toolCalls)"
          fillOpacity={0.7}
          stroke="var(--color-toolCalls)"
        />
        <Area
          dataKey="evidence"
          stackId="run"
          type="natural"
          fill="var(--color-evidence)"
          fillOpacity={0.55}
          stroke="var(--color-evidence)"
        />
        <Area
          dataKey="approvals"
          stackId="run"
          type="natural"
          fill="var(--color-approvals)"
          fillOpacity={0.45}
          stroke="var(--color-approvals)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

function ToolUsageDonutPreview() {
  const data = [
    { name: "Files", value: 4, fill: "var(--chart-2)" },
    { name: "Shell", value: 2, fill: "var(--chart-3)" },
    { name: "Memory", value: 1, fill: "var(--chart-5)" },
  ];
  return (
    <CatalogPreviewFrame className="grid gap-3 min-[460px]:grid-cols-[116px_minmax(0,1fr)]">
      <ChartContainer config={toolUsageConfig} className="aspect-square h-[116px] justify-self-center">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={28}
            outerRadius={48}
            strokeWidth={3}
          />
        </PieChart>
      </ChartContainer>
      <div className="grid content-center gap-2 text-xs">
        {data.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ background: item.fill }}
              />
              {item.name}
            </span>
            <span className="font-medium">{item.value}</span>
          </div>
        ))}
      </div>
    </CatalogPreviewFrame>
  );
}

function CapabilityRadarPreview() {
  return (
    <ChartContainer
      config={radarConfig}
      className="h-[150px] w-full rounded-2xl border bg-muted/20 p-2 aspect-auto"
    >
      <RadarChart
        data={[
          { capability: "Plan", score: 95 },
          { capability: "Tools", score: 88 },
          { capability: "Memory", score: 72 },
          { capability: "Approval", score: 84 },
          { capability: "Files", score: 91 },
        ]}
      >
        <PolarAngleAxis dataKey="capability" tick={{ fontSize: 10 }} />
        <PolarGrid />
        <Radar
          dataKey="score"
          fill="var(--color-score)"
          fillOpacity={0.25}
          stroke="var(--color-score)"
          strokeWidth={2}
        />
      </RadarChart>
    </ChartContainer>
  );
}

function ApprovalRadialPreview() {
  return (
    <CatalogPreviewFrame className="grid gap-3 min-[460px]:grid-cols-[116px_minmax(0,1fr)]">
      <ChartContainer config={radialConfig} className="aspect-square h-[116px] justify-self-center">
        <RadialBarChart
          data={[
            { label: "Approval", value: 82, fill: "var(--chart-2)" },
            { label: "Tests", value: 64, fill: "var(--chart-3)" },
          ]}
          innerRadius={24}
          outerRadius={50}
          startAngle={90}
          endAngle={-270}
        >
          <RadialBar dataKey="value" background cornerRadius={10} />
        </RadialBarChart>
      </ChartContainer>
      <div className="grid content-center gap-3">
        <div className="grid gap-1">
          <div className="flex justify-between text-xs">
            <span>Approval ready</span>
            <span>82%</span>
          </div>
          <Progress value={82} />
        </div>
        <div className="grid gap-1">
          <div className="flex justify-between text-xs">
            <span>Tests complete</span>
            <span>64%</span>
          </div>
          <Progress value={64} />
        </div>
      </div>
    </CatalogPreviewFrame>
  );
}

function CalendarPreview() {
  return (
    <CatalogPreviewFrame className="grid gap-3">
      <div className="max-w-full overflow-hidden rounded-xl bg-background">
        <Calendar
          mode="single"
          selected={new Date("2026-06-03T12:00:00")}
          month={new Date("2026-06-01T12:00:00")}
          className="mx-auto max-w-full rounded-xl p-2 [--cell-size:1.7rem]"
        />
      </div>
      <div className="grid min-w-0 gap-2 text-sm">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" />
          Approval window
        </div>
        <div className="text-xs text-muted-foreground">
          Show stage dates, verification handoff, and presenter schedule.
        </div>
      </div>
    </CatalogPreviewFrame>
  );
}

function FileImpactPreview() {
  return (
    <CatalogPreviewFrame className="grid gap-2">
      {[
        ["calculator.ts", "high"],
        ["calculator.test.ts", "low"],
      ].map(([path, risk]) => (
        <div
          key={path}
          className="flex items-center justify-between rounded-xl border bg-background p-2 text-sm"
        >
          <span className="flex items-center gap-2 font-mono text-xs">
            <FileCode2 className="size-4 text-primary" />
            {path}
          </span>
          <Badge variant="secondary">{risk}</Badge>
        </div>
      ))}
    </CatalogPreviewFrame>
  );
}

function ApprovalFormPreview() {
  return (
    <CatalogPreviewFrame className="grid gap-2">
      <div className="grid gap-2 min-[460px]:grid-cols-[minmax(0,1fr)_120px]">
        <Input readOnly value="pnpm_run test" />
        <Select value="medium" disabled>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="medium">Medium</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between rounded-xl border bg-background p-2 text-sm">
        <span className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-primary" />
          Ready for approval
        </span>
        <Switch checked disabled />
      </div>
    </CatalogPreviewFrame>
  );
}

function RunHealthTablePreview() {
  return (
    <CatalogPreviewFrame className="p-0">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Check</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ["Tests", "pass", 100],
            ["Coverage", "running", 66],
            ["Memory", "pass", 100],
          ].map(([check, status, progress]) => (
            <TableRow key={check}>
              <TableCell>{check}</TableCell>
              <TableCell>
                <ToneBadge tone={statusTone(status as RunHealthRowStatus)}>
                  {status}
                </ToneBadge>
              </TableCell>
              <TableCell>
                <Progress value={Number(progress)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CatalogPreviewFrame>
  );
}

function HandoffFormPreview() {
  return (
    <CatalogPreviewFrame className="grid gap-2">
      <Input readOnly value="Build demo presenter" />
      <Textarea
        readOnly
        value="Bug fixed, tests passed, memory saved."
        className="min-h-16 resize-none"
      />
      <div className="flex items-center gap-2 rounded-xl border bg-background p-2 text-sm">
        <ChartNoAxesCombined className="size-4 text-primary" />
        Add release-note follow-up
      </div>
    </CatalogPreviewFrame>
  );
}

type RunHealthRowStatus = z.infer<typeof runHealthRowSchema>["status"];

function statusTone(
  status: RunHealthRowStatus,
): "default" | "success" | "warning" | "danger" {
  if (status === "pass") return "success";
  if (status === "running") return "warning";
  if (status === "fail") return "danger";
  return "default";
}

function ToneBadge({
  tone,
  children,
}: {
  tone?: "default" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        tone === "success" && "bg-emerald-100 text-emerald-800",
        tone === "warning" && "bg-amber-100 text-amber-800",
        tone === "danger" && "bg-red-100 text-red-800",
      )}
    >
      {children}
    </Badge>
  );
}
