"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LineChart,
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
  Check,
  ClipboardCheck,
  FileCode2,
  LayoutGrid,
  ListChecks,
  Play,
  Search,
} from "lucide-react";
import { createContext, useContext, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
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
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CONTROL_ROOM_AGENT_NAME,
  useControlRoomLocal,
  useSendUserMessage,
} from "@/hooks/use-control-room-state";
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

const barPointSchema = z.object({
  label: z.string().describe("Short x-axis label."),
  value: z.number().describe("Bar value."),
});

const linePointSchema = z.object({
  label: z.string().describe("Short x-axis label."),
  value: z.number().describe("Primary line value."),
});

const areaPointSchema = z.object({
  stage: z.string().describe("Short x-axis label."),
  confidence: z.number().describe("Primary area-series value from 0 to 100."),
  failures: z.number().describe("Secondary comparison value."),
});

const stackedAreaPointSchema = z.object({
  stage: z.string().describe("Short x-axis label."),
  toolCalls: z.number().describe("First stacked-series value."),
  evidence: z.number().describe("Second stacked-series value."),
  approvals: z.number().describe("Third stacked-series value."),
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
  status: z
    .enum(["pass", "running", "blocked", "fail"])
    .describe("Check status."),
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

const BarChartProps = z.object({
  title: z.string().describe("Short bar chart title."),
  summary: z.string().describe("One-sentence explanation of the comparison."),
  data: z
    .array(barPointSchema)
    .min(2)
    .max(8)
    .describe("Category values for the bar chart."),
});

const LineChartProps = z.object({
  title: z.string().describe("Short line chart title."),
  summary: z.string().describe("One-sentence explanation of the trend."),
  data: z
    .array(linePointSchema)
    .min(2)
    .max(8)
    .describe("Ordered values for the line chart."),
});

const CalendarComponentProps = z.object({
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
    .describe("Values for a primary area series and optional comparison."),
});

const WorkstreamStackedAreaProps = z.object({
  title: z.string().describe("Short stacked area chart title."),
  summary: z.string().describe("One-sentence explanation of the activity mix."),
  data: z
    .array(stackedAreaPointSchema)
    .min(2)
    .max(8)
    .describe("Values for three stacked area series."),
});

const ToolUsageDonutProps = z.object({
  title: z.string().describe("Short donut chart title."),
  summary: z.string().describe("One-sentence explanation of tool usage."),
  data: z
    .array(usageSliceSchema)
    .min(2)
    .max(8)
    .describe(
      "Tool usage slices such as file reads, shell runs, approvals, memory.",
    ),
});

const CapabilityRadarProps = z.object({
  title: z.string().describe("Short radar chart title."),
  summary: z
    .string()
    .describe("One-sentence explanation of capability coverage."),
  data: z
    .array(capabilityScoreSchema)
    .min(3)
    .max(8)
    .describe("Harness capability scores for the radar chart."),
});

const ApprovalRadialProps = z.object({
  title: z.string().describe("Short radial progress title."),
  summary: z
    .string()
    .describe("One-sentence explanation of approval readiness."),
  metrics: z
    .array(radialMetricSchema)
    .min(1)
    .max(4)
    .describe(
      "Radial progress metrics for approval readiness or verification.",
    ),
});

const RunHealthTableProps = z.object({
  title: z.string().describe("Short table title."),
  summary: z.string().describe("One-sentence explanation of run health."),
  rows: z
    .array(runHealthRowSchema)
    .min(2)
    .max(8)
    .describe(
      "Rows for tests, coverage, typecheck, approvals, memory, and files.",
    ),
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

const DISPLAY_COMPONENT_FINAL_ACTION =
  "This is a display-only component. Use it only as the final action of the current response, after every required Harness tool result is complete. Never call it in the same model step as a pending mode change, todo update, file read, file write, memory write, approval request, or shell command. Never use it to claim todos, memory, files, tests, approval, or shell work unless the matching Harness tool result is already present in the conversation.";

export const GENERATIVE_UI_CATALOG = [
  {
    id: "summary",
    name: "showHarnessSummary",
    label: "Harness Summary",
    category: "Status",
    description: "Summarizes mode, todos, approvals, files, tests, and memory.",
  },
  {
    id: "bar",
    name: "showBarChart",
    label: "Bar Chart",
    category: "Charts",
    description: "Compare values across categories.",
  },
  {
    id: "line",
    name: "showLineChart",
    label: "Line Chart",
    category: "Charts",
    description: "Show movement across a sequence or timeline.",
  },
  {
    id: "coverage",
    name: "showAreaChart",
    label: "Area Chart",
    category: "Charts",
    description: "Show a trend with a filled line and supporting comparison.",
  },
  {
    id: "workstream",
    name: "showStackedAreaChart",
    label: "Stacked Area Chart",
    category: "Charts",
    description: "Compare multiple series across one shared timeline.",
  },
  {
    id: "usage",
    name: "showDonutChart",
    label: "Donut Chart",
    category: "Charts",
    description: "Show a compact proportional breakdown by category.",
  },
  {
    id: "radar",
    name: "showRadarChart",
    label: "Radar Chart",
    category: "Charts",
    description: "Compare scores across several dimensions.",
  },
  {
    id: "radial",
    name: "showRadialChart",
    label: "Radial Chart",
    category: "Charts",
    description: "Show progress values as circular bars.",
  },
  {
    id: "calendar",
    name: "showCalendar",
    label: "Calendar",
    category: "Schedule",
    description: "Shows dated milestones, windows, and handoff timing.",
  },
  {
    id: "runHealth",
    name: "showRunHealthTable",
    label: "Run Health Table",
    category: "Tables",
    description: "Shows tests, coverage, approvals, and memory with progress.",
  },
  {
    id: "files",
    name: "showFileImpactMap",
    label: "File Impact Map",
    category: "Files",
    description: "Shows files the Harness inspected or changed.",
  },
  {
    id: "approval",
    name: "showApprovalReadinessForm",
    label: "Approval Form",
    category: "Forms",
    description: "Shows an approval checklist before risky Harness actions.",
  },
  {
    id: "handoff",
    name: "showHandoffForm",
    label: "Handoff Form",
    category: "Forms",
    description: "Shows memory, owner, notes, and follow-up items.",
  },
] as const;

type CatalogItemId = (typeof GENERATIVE_UI_CATALOG)[number]["id"];
type CatalogItem = (typeof GENERATIVE_UI_CATALOG)[number];
type CatalogState = Record<CatalogItemId, boolean>;

type CatalogPreset = {
  id: string;
  label: string;
  description: string;
  itemIds: readonly CatalogItemId[];
};

const createTryPrompt = (componentName: string, label: string) =>
  `Render exactly one ${componentName} component as the final action, showing a simple demonstrative ${label} with small illustrative data. Include every required field for that component, including any arrays such as metrics, data, rows, events, files, checks, or followups. Do not inspect files, update todos, save memory, request approval, or run commands.`;

const TRY_COMPONENT_PROMPTS: Record<CatalogItemId, string> = {
  summary: createTryPrompt("showHarnessSummary", "Harness Summary"),
  bar: createTryPrompt("showBarChart", "Bar Chart"),
  line: createTryPrompt("showLineChart", "Line Chart"),
  coverage: createTryPrompt("showAreaChart", "Area Chart"),
  workstream: createTryPrompt("showStackedAreaChart", "Stacked Area Chart"),
  usage: createTryPrompt("showDonutChart", "Donut Chart"),
  radar: createTryPrompt("showRadarChart", "Radar Chart"),
  radial: createTryPrompt("showRadialChart", "Radial Chart"),
  calendar: createTryPrompt("showCalendar", "Calendar"),
  files: createTryPrompt("showFileImpactMap", "File Impact Map"),
  runHealth: createTryPrompt("showRunHealthTable", "Run Health Table"),
  approval: createTryPrompt("showApprovalReadinessForm", "Approval Form"),
  handoff: createTryPrompt("showHandoffForm", "Handoff Form"),
};

const createA2UITryPrompt = (label: string, composition: string) =>
  `Render A2UI as the final action. Use render_control_room_a2ui exactly once with a flat components array. The root node must be { id: "root", component: "Surface" }. Container nodes must reference child ids with children arrays; do not inline children. Compose a small ${label} demo using the A2UI catalog, not any show... useComponent display tool. ${composition} Do not inspect files, update todos, save memory, request approval, run commands, or call another display tool afterward.`;

const A2UI_TRY_COMPONENT_PROMPTS: Record<CatalogItemId, string> = {
  summary: createA2UITryPrompt(
    "Harness Summary",
    "Use a Surface with one Card containing three Metric nodes for mode, todos, and approvals.",
  ),
  bar: createA2UITryPrompt(
    "Bar Chart",
    "Use a Card containing a BarChart with four category values.",
  ),
  line: createA2UITryPrompt(
    "Line Chart",
    "Use a Card containing a LineChart with five ordered values.",
  ),
  coverage: createA2UITryPrompt(
    "Area Chart",
    "Use a Card containing an AreaChart with progress values and a secondary comparison series.",
  ),
  workstream: createA2UITryPrompt(
    "Stacked Area Chart",
    "Use a Card containing a StackedAreaChart with toolCalls, evidence, and approvals values.",
  ),
  usage: createA2UITryPrompt(
    "Donut Chart",
    "Use a Card containing a DonutChart with tool usage slices.",
  ),
  radar: createA2UITryPrompt(
    "Radar Chart",
    "Use a Card containing a RadarChart with capability scores.",
  ),
  radial: createA2UITryPrompt(
    "Radial Chart",
    "Use a Card containing a RadialChart with two readiness metrics.",
  ),
  calendar: createA2UITryPrompt(
    "Calendar",
    "Use a Card containing a Calendar with two dated milestone events.",
  ),
  files: createA2UITryPrompt(
    "File Impact Map",
    "Use a Card containing a FileImpactMap with three files and risk labels.",
  ),
  runHealth: createA2UITryPrompt(
    "Run Health Table",
    "Use a Card containing a RunHealthTable with tests, typecheck, and approval rows.",
  ),
  approval: createA2UITryPrompt(
    "Approval Form",
    "Use a Card containing an ApprovalForm with command, risk, and readiness checks.",
  ),
  handoff: createA2UITryPrompt(
    "Handoff Form",
    "Use a Card containing a HandoffForm with owner, notes, and follow-up items.",
  ),
};

const DEFAULT_CATALOG_STATE: CatalogState = {
  summary: true,
  bar: true,
  line: true,
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

const DEFAULT_SUMMARY_METRICS: z.infer<typeof metricSchema>[] = [
  { label: "Mode", value: "Plan" },
  { label: "Todos", value: "3" },
  { label: "Files", value: "2" },
];

const DEFAULT_BAR_DATA: z.infer<typeof barPointSchema>[] = [
  { label: "Alpha", value: 3 },
  { label: "Beta", value: 5 },
  { label: "Gamma", value: 4 },
];

const DEFAULT_LINE_DATA: z.infer<typeof linePointSchema>[] = [
  { label: "Jan", value: 12 },
  { label: "Feb", value: 18 },
  { label: "Mar", value: 16 },
  { label: "Apr", value: 24 },
];

const DEFAULT_AREA_DATA: z.infer<typeof areaPointSchema>[] = [
  { stage: "Plan", confidence: 35, failures: 3 },
  { stage: "Fix", confidence: 70, failures: 1 },
  { stage: "Verify", confidence: 94, failures: 0 },
];

const DEFAULT_STACKED_AREA_DATA: z.infer<typeof stackedAreaPointSchema>[] = [
  { stage: "Plan", toolCalls: 2, evidence: 1, approvals: 0 },
  { stage: "Fix", toolCalls: 4, evidence: 3, approvals: 1 },
  { stage: "Verify", toolCalls: 3, evidence: 4, approvals: 2 },
];

const DEFAULT_USAGE_DATA: z.infer<typeof usageSliceSchema>[] = [
  { name: "Files", value: 4 },
  { name: "Shell", value: 2 },
  { name: "Memory", value: 1 },
];

const DEFAULT_RADAR_DATA: z.infer<typeof capabilityScoreSchema>[] = [
  { capability: "Plan", score: 90 },
  { capability: "Tools", score: 82 },
  { capability: "Memory", score: 74 },
  { capability: "Approval", score: 78 },
  { capability: "Files", score: 88 },
];

const DEFAULT_RADIAL_METRICS: z.infer<typeof radialMetricSchema>[] = [
  { label: "Approval ready", value: 82 },
  { label: "Tests complete", value: 64 },
];

const DEFAULT_TIMELINE_EVENTS: z.infer<typeof timelineEventSchema>[] = [
  {
    label: "Approval window",
    date: "2026-06-03",
    detail: "Presenter approval checkpoint.",
    tone: "warning",
  },
];

const DEFAULT_APPROVAL_CHECKS: z.infer<typeof approvalCheckSchema>[] = [
  { label: "Diff reviewed", complete: true },
  { label: "Command scoped", complete: true },
  { label: "Ready for approval", complete: false },
];

const DEFAULT_FOLLOWUPS = ["Share demo handoff", "Capture final verification"];

const DEFAULT_FILE_IMPACTS: z.infer<typeof fileImpactSchema>[] = [
  {
    path: "calculator.ts",
    risk: "high",
    change: "Primary implementation file.",
  },
  {
    path: "calculator.test.ts",
    risk: "low",
    change: "Test contract for the repair.",
  },
];

const DEFAULT_RUN_HEALTH_ROWS: z.infer<typeof runHealthRowSchema>[] = [
  {
    check: "Tests",
    status: "pass",
    progress: 100,
    detail: "Fixture tests are passing.",
  },
  {
    check: "Coverage",
    status: "running",
    progress: 66,
    detail: "Coverage verification is in progress.",
  },
  {
    check: "Memory",
    status: "pass",
    progress: 100,
    detail: "Handoff memory is saved.",
  },
];

function withFallbackArray<T>(value: T[] | undefined, fallback: T[]) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

const CHART_SERIES = {
  indigo: "var(--cr-chart-indigo)",
  blue: "var(--cr-chart-blue)",
  mint: "var(--cr-chart-mint)",
  lavender: "var(--cr-chart-lavender)",
  sky: "var(--cr-chart-sky)",
} as const;

const EMPTY_CATALOG_STATE: CatalogState = {
  summary: false,
  bar: false,
  line: false,
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
};

const CATALOG_PRESETS: CatalogPreset[] = [
  {
    id: "all",
    label: "All",
    description: "Enable every component.",
    itemIds: GENERATIVE_UI_CATALOG.map((item) => item.id),
  },
  {
    id: "charts",
    label: "Charts",
    description: "Bar, line, area, activity, usage, radar, and radial views.",
    itemIds: [
      "bar",
      "line",
      "coverage",
      "workstream",
      "usage",
      "radar",
      "radial",
    ],
  },
  {
    id: "harness",
    label: "Harness",
    description: "Status, run health, file impact, approval, and handoff.",
    itemIds: ["summary", "runHealth", "files", "approval", "handoff"],
  },
  {
    id: "scheduling",
    label: "Scheduling",
    description: "Calendar and handoff timing views.",
    itemIds: ["calendar", "handoff"],
  },
  {
    id: "forms",
    label: "Forms",
    description: "Approval and handoff input surfaces.",
    itemIds: ["approval", "handoff"],
  },
  {
    id: "execution",
    label: "Execution",
    description: "Run health, tool mix, and approval readiness.",
    itemIds: ["runHealth", "usage", "radial"],
  },
  {
    id: "none",
    label: "None",
    description: "Disable every component.",
    itemIds: [],
  },
];

type GenerativeUICatalogContextValue = {
  enabled: CatalogState;
  enabledItems: CatalogItem[];
  setEnabled: (id: CatalogItemId, value: boolean) => void;
  setEnabledItems: (ids: readonly CatalogItemId[]) => void;
};

const GenerativeUICatalogContext =
  createContext<GenerativeUICatalogContextValue | null>(null);

export function GenerativeUICatalogProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [enabled, setEnabledState] = useState<CatalogState>(
    DEFAULT_CATALOG_STATE,
  );

  const value = useMemo<GenerativeUICatalogContextValue>(
    () => ({
      enabled,
      enabledItems: GENERATIVE_UI_CATALOG.filter((item) => enabled[item.id]),
      setEnabled: (id, nextValue) =>
        setEnabledState((current) => ({ ...current, [id]: nextValue })),
      setEnabledItems: (ids) => {
        const nextState = { ...EMPTY_CATALOG_STATE };
        ids.forEach((id) => {
          nextState[id] = true;
        });
        setEnabledState(nextState);
      },
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
  const { localState } = useControlRoomLocal();

  if (!localState.openGenerativeUIEnabled || localState.a2uiEnabled) {
    return null;
  }

  return (
    <>
      {enabled.summary ? <HarnessSummaryRegistration /> : null}
      {enabled.bar ? <BarChartRegistration /> : null}
      {enabled.line ? <LineChartRegistration /> : null}
      {enabled.coverage ? <CoverageAreaChartRegistration /> : null}
      {enabled.workstream ? <WorkstreamStackedAreaRegistration /> : null}
      {enabled.usage ? <ToolUsageDonutRegistration /> : null}
      {enabled.radar ? <CapabilityRadarRegistration /> : null}
      {enabled.radial ? <ApprovalRadialRegistration /> : null}
      {enabled.calendar ? <CalendarComponentRegistration /> : null}
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
  const { enabled, setEnabled, setEnabledItems } = useGenerativeUICatalog();
  const { localState, setA2UIEnabled, setOpenGenerativeUIEnabled } =
    useControlRoomLocal();
  const { send, isRunning } = useSendUserMessage();
  const normalizedQuery = query.trim().toLowerCase();
  const renderingEnabled =
    localState.a2uiEnabled || localState.openGenerativeUIEnabled;
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return GENERATIVE_UI_CATALOG;
    return GENERATIVE_UI_CATALOG.filter((item) =>
      `${item.label} ${item.name} ${item.category} ${item.description}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query]);
  const tryComponent = async (item: CatalogItem) => {
    if (isRunning || !renderingEnabled) return;
    if (!enabled[item.id]) {
      flushSync(() => setEnabled(item.id, true));
      await waitForNextFrame();
    }
    await send(
      localState.a2uiEnabled
        ? A2UI_TRY_COMPONENT_PROMPTS[item.id]
        : TRY_COMPONENT_PROMPTS[item.id],
    );
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <ScrollArea className="h-full">
          <div className="space-y-3 px-4 pb-7 pt-4">
            <div className="flex h-7 items-center justify-between gap-3">
              <CatalogPresetPopover
                enabled={enabled}
                onApplyPreset={setEnabledItems}
              />
              <RenderingModeControls
                a2uiEnabled={localState.a2uiEnabled}
                openGenerativeUIEnabled={localState.openGenerativeUIEnabled}
                onA2UIEnabledChange={setA2UIEnabled}
                onOpenGenerativeUIEnabledChange={setOpenGenerativeUIEnabled}
              />
            </div>
            <div className="group relative flex h-11 min-w-0 items-center gap-2 rounded-xl border border-border/80 bg-card px-3.5 shadow-sm transition-colors focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10">
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary transition-colors group-focus-within:bg-primary/15">
                <Search className="size-3.5" />
              </span>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search components"
                className="h-full min-w-0 border-0 bg-transparent px-0 py-0 text-[15px] shadow-none placeholder:text-muted-foreground/80 focus-visible:border-0 focus-visible:ring-0"
              />
            </div>
            <div className="-mx-4 px-4 py-1.5">
              <Separator />
            </div>
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <CatalogItemRow
                  key={item.id}
                  item={item}
                  enabled={enabled[item.id]}
                  onEnabledChange={(checked) => setEnabled(item.id, checked)}
                  onTry={() => void tryComponent(item)}
                  isTryingDisabled={isRunning || !renderingEnabled}
                  renderingEnabled={renderingEnabled}
                />
              ))}
              {filteredItems.length === 0 ? (
                <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                  No components match that search.
                </div>
              ) : null}
            </div>
          </div>
        </ScrollArea>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-background via-background/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-7 bg-gradient-to-t from-background via-background/85 to-transparent" />
      </div>
    </div>
  );
}

function CatalogPresetPopover({
  enabled,
  onApplyPreset,
}: {
  enabled: CatalogState;
  onApplyPreset: (ids: readonly CatalogItemId[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="cr-brand-gradient-control h-5 shrink-0 rounded-md border-transparent px-2 text-white shadow-none hover:text-white aria-expanded:text-white"
          aria-label="Choose component catalog"
          title="Catalog"
        >
          <LayoutGrid className="size-2.5 text-white" />
          <span className="text-[11px] font-medium leading-none">Catalogs</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="px-2 pb-2 pt-1">
          <div className="text-sm font-medium">Catalog</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Enable a focused set of components.
          </p>
        </div>
        <div className="space-y-1">
          {CATALOG_PRESETS.map((preset) => {
            const active = isCatalogPresetActive(enabled, preset.itemIds);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyPreset(preset.itemIds)}
                className={cn(
                  "flex w-full min-w-0 items-start gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                  active ? "bg-muted" : undefined,
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent",
                  )}
                  aria-hidden
                >
                  <Check className="size-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="font-medium">{preset.label}</span>
                    <Badge variant="secondary" className="shrink-0">
                      {preset.itemIds.length}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {preset.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function isCatalogPresetActive(
  enabled: CatalogState,
  itemIds: readonly CatalogItemId[],
) {
  const presetIds = new Set(itemIds);
  return GENERATIVE_UI_CATALOG.every((item) => {
    return enabled[item.id] === presetIds.has(item.id);
  });
}

function waitForNextFrame() {
  if (typeof requestAnimationFrame === "undefined") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function RenderingModeControls({
  a2uiEnabled,
  openGenerativeUIEnabled,
  onA2UIEnabledChange,
  onOpenGenerativeUIEnabledChange,
}: {
  a2uiEnabled: boolean;
  openGenerativeUIEnabled: boolean;
  onA2UIEnabledChange: (enabled: boolean) => void;
  onOpenGenerativeUIEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-end gap-3 px-1">
      <RenderingModeSwitch
        title="A2UI"
        tooltip="Composes selected components into one generated surface."
        enabled={a2uiEnabled}
        onEnabledChange={onA2UIEnabledChange}
      />
      <RenderingModeSwitch
        title="Open Gen UI"
        tooltip="Registers selected components as individual display tools."
        enabled={openGenerativeUIEnabled}
        onEnabledChange={onOpenGenerativeUIEnabledChange}
      />
    </div>
  );
}

function RenderingModeSwitch({
  title,
  tooltip,
  enabled,
  onEnabledChange,
}: {
  title: string;
  tooltip: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="flex h-6 min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Switch
            size="sm"
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-label={`Enable ${title}`}
            className="cr-brand-gradient-switch"
          />
          <span className="whitespace-nowrap">{title}</span>
        </label>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="max-w-48 rounded-lg px-2 py-1 text-left text-[11px] leading-snug"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function CatalogItemRow({
  item,
  enabled,
  onEnabledChange,
  onTry,
  isTryingDisabled,
  renderingEnabled,
}: {
  item: CatalogItem;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onTry: () => void;
  isTryingDisabled: boolean;
  renderingEnabled: boolean;
}) {
  const checkboxId = useId();

  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/20",
        enabled ? "border-border" : "border-border/80",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Checkbox
          id={checkboxId}
          checked={enabled}
          onCheckedChange={(checked) => onEnabledChange(checked === true)}
        />
        <label
          htmlFor={checkboxId}
          className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
        >
          {item.label}
        </label>
        <Button
          type="button"
          size="sm"
          onClick={onTry}
          disabled={isTryingDisabled}
          title={
            isTryingDisabled
              ? renderingEnabled
                ? "Agent is busy. Try after the current run finishes."
                : "Enable Open Gen UI or A2UI to try this component."
              : `Ask the agent to render ${item.label}.`
          }
          variant="outline"
          className="h-7 shrink-0 rounded-lg px-2.5 text-xs shadow-none"
        >
          <Play className="size-3" />
          Try
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {item.description}
      </p>
      <CatalogPreview itemId={item.id} />
    </div>
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
        "flex w-full min-w-0 flex-col items-center overflow-hidden rounded-xl border bg-muted/20 p-3",
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
      return <HarnessSummaryPreview />;
    case "bar":
      return <BarChartPreview />;
    case "line":
      return <LineChartPreview />;
    case "coverage":
      return <CoverageAreaPreview />;
    case "workstream":
      return <WorkstreamStackedAreaPreview />;
    case "usage":
      return <ToolUsageDonutPreview />;
    case "radar":
      return <CapabilityRadarPreview />;
    case "radial":
      return <ApprovalRadialPreview />;
    case "calendar":
      return <CalendarPreview />;
    case "files":
      return <FileImpactPreview />;
    case "runHealth":
      return <RunHealthTablePreview />;
    case "approval":
      return <ApprovalFormPreview />;
    case "handoff":
      return <HandoffFormPreview />;
  }
}

function HarnessSummaryRegistration() {
  useComponent({
    name: "showHarnessSummary",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: HarnessSummaryProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Use this for concise stage status summaries after planning, after a patch, after a test run, or during final review. Populate metrics with Harness-specific values such as mode, todos, files, approvals, last test, and memory.`,
    render: HarnessSummaryCard,
  });
  return null;
}

function BarChartRegistration() {
  useComponent({
    name: "showBarChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: BarChartProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Display a simple bar chart for comparing category values. Use it when discrete values should be compared side-by-side.`,
    render: BarChartCard,
  });
  return null;
}

function LineChartRegistration() {
  useComponent({
    name: "showLineChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: LineChartProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Display a simple line chart for ordered values. Use it when movement, trend, or sequence is the primary point.`,
    render: LineChartCard,
  });
  return null;
}

function CoverageAreaChartRegistration() {
  useComponent({
    name: "showAreaChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: CoverageAreaChartProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Display an area chart for one primary trend with an optional comparison series. Use it for momentum, confidence, load, or other continuous values.`,
    render: CoverageAreaChart,
  });
  return null;
}

function WorkstreamStackedAreaRegistration() {
  useComponent({
    name: "showStackedAreaChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: WorkstreamStackedAreaProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Display a stacked area chart for three related series across a shared x-axis. Use it when composition over time matters.`,
    render: WorkstreamStackedArea,
  });
  return null;
}

function ToolUsageDonutRegistration() {
  useComponent({
    name: "showDonutChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: ToolUsageDonutProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Display a donut chart for proportional category breakdowns. Keep labels short and use it for compact totals.`,
    render: ToolUsageDonut,
  });
  return null;
}

function CapabilityRadarRegistration() {
  useComponent({
    name: "showRadarChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: CapabilityRadarProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Display a radar chart for comparing scores across several dimensions.`,
    render: CapabilityRadar,
  });
  return null;
}

function ApprovalRadialRegistration() {
  useComponent({
    name: "showRadialChart",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: ApprovalRadialProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Display one or more radial progress values as compact circular bars.`,
    render: ApprovalRadial,
  });
  return null;
}

function CalendarComponentRegistration() {
  useComponent({
    name: "showCalendar",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: CalendarComponentProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Use this to show dated milestones, approval windows, or handoff schedules. Choose realistic ISO dates and keep labels short enough for a stage demo.`,
    render: CalendarCard,
  });
  return null;
}

function ApprovalReadinessFormRegistration() {
  useComponent({
    name: "showApprovalReadinessForm",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: ApprovalReadinessFormProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Use this form-style component only when the current turn is explicitly a readiness preview, not when the real Harness approval card is required. It should show the command, risk level, and readiness checks for the presenter.`,
    render: ApprovalReadinessForm,
  });
  return null;
}

function HandoffFormRegistration() {
  useComponent({
    name: "showHandoffForm",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: HandoffFormProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Use this form-style component during handoff after memory has already been saved. It should summarize owner, notes, and follow-up items for handoff.`,
    render: HandoffForm,
  });
  return null;
}

function FileImpactMapRegistration() {
  useComponent({
    name: "showFileImpactMap",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: FileImpactMapProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Use this after inspecting or changing files. Show workspace-relative paths, risk level, and why each file matters.`,
    render: FileImpactMap,
  });
  return null;
}

function RunHealthTableRegistration() {
  useComponent({
    name: "showRunHealthTable",
    agentId: CONTROL_ROOM_AGENT_NAME,
    parameters: RunHealthTableProps,
    followUp: false,
    description: `${DISPLAY_COMPONENT_FINAL_ACTION} Use this table when the audience should see run health as rows: tests, coverage, typecheck, approvals, files, and memory with status and progress.`,
    render: RunHealthTable,
  });
  return null;
}

function HarnessSummaryCard({
  title,
  status,
  metrics,
}: z.infer<typeof HarnessSummaryProps>) {
  const safeMetrics = withFallbackArray(metrics, DEFAULT_SUMMARY_METRICS);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          Harness summary
        </Badge>
        <CardTitle>{title ?? "Harness Summary"}</CardTitle>
        <CardDescription>{status ?? "Current run status."}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {safeMetrics.map((metric) => (
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

const barChartConfig = {
  value: { label: "Value", color: CHART_SERIES.blue },
} satisfies ChartConfig;

function BarChartCard({ title, summary, data }: z.infer<typeof BarChartProps>) {
  const safeData = withFallbackArray(data, DEFAULT_BAR_DATA);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          bar chart
        </Badge>
        <CardTitle>{title ?? "Bar Chart"}</CardTitle>
        <CardDescription>
          {summary ?? "Compare values across categories."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={barChartConfig} className="min-h-[260px]">
          <BarChart data={safeData} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="value"
              fill={CHART_SERIES.blue}
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const lineChartConfig = {
  value: { label: "Value", color: CHART_SERIES.indigo },
} satisfies ChartConfig;

function LineChartCard({
  title,
  summary,
  data,
}: z.infer<typeof LineChartProps>) {
  const safeData = withFallbackArray(data, DEFAULT_LINE_DATA);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          line chart
        </Badge>
        <CardTitle>{title ?? "Line Chart"}</CardTitle>
        <CardDescription>
          {summary ?? "Show movement across a sequence."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={lineChartConfig} className="min-h-[260px]">
          <LineChart data={safeData} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={CHART_SERIES.indigo}
              strokeWidth={3}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const coverageAreaConfig = {
  confidence: { label: "Primary", color: CHART_SERIES.indigo },
  failures: { label: "Comparison", color: CHART_SERIES.mint },
} satisfies ChartConfig;

function CoverageAreaChart({
  title,
  summary,
  data,
}: z.infer<typeof CoverageAreaChartProps>) {
  const safeData = withFallbackArray(data, DEFAULT_AREA_DATA);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          area chart
        </Badge>
        <CardTitle>{title ?? "Area Chart"}</CardTitle>
        <CardDescription>
          {summary ?? "Show a trend with a filled line."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={coverageAreaConfig} className="min-h-[260px]">
          <AreaChart data={safeData} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="stage" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="confidence"
              type="natural"
              fill={CHART_SERIES.indigo}
              fillOpacity={0.28}
              stroke={CHART_SERIES.indigo}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="failures"
              stroke={CHART_SERIES.mint}
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
  toolCalls: { label: "Series A", color: CHART_SERIES.indigo },
  evidence: { label: "Series B", color: CHART_SERIES.blue },
  approvals: { label: "Series C", color: CHART_SERIES.mint },
} satisfies ChartConfig;

function WorkstreamStackedArea({
  title,
  summary,
  data,
}: z.infer<typeof WorkstreamStackedAreaProps>) {
  const safeData = withFallbackArray(data, DEFAULT_STACKED_AREA_DATA);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          stacked area
        </Badge>
        <CardTitle>{title ?? "Stacked Area Chart"}</CardTitle>
        <CardDescription>
          {summary ?? "Compare multiple series over time."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={workstreamStackConfig}
          className="min-h-[260px]"
        >
          <AreaChart data={safeData} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="stage" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="toolCalls"
              stackId="run"
              type="natural"
              fill={CHART_SERIES.indigo}
              fillOpacity={0.7}
              stroke={CHART_SERIES.indigo}
            />
            <Area
              dataKey="evidence"
              stackId="run"
              type="natural"
              fill={CHART_SERIES.blue}
              fillOpacity={0.55}
              stroke={CHART_SERIES.blue}
            />
            <Area
              dataKey="approvals"
              stackId="run"
              type="natural"
              fill={CHART_SERIES.mint}
              fillOpacity={0.4}
              stroke={CHART_SERIES.mint}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const toolUsageConfig = {
  value: { label: "Usage" },
  files: { label: "Files", color: CHART_SERIES.blue },
  shell: { label: "Shell", color: CHART_SERIES.indigo },
  approvals: { label: "Approvals", color: CHART_SERIES.mint },
  memory: { label: "Memory", color: CHART_SERIES.lavender },
  todos: { label: "Todos", color: CHART_SERIES.sky },
} satisfies ChartConfig;

const donutColors = [
  CHART_SERIES.indigo,
  CHART_SERIES.blue,
  CHART_SERIES.mint,
  CHART_SERIES.lavender,
  CHART_SERIES.sky,
];

function ToolUsageDonut({
  title,
  summary,
  data,
}: z.infer<typeof ToolUsageDonutProps>) {
  const chartData = withFallbackArray(data, DEFAULT_USAGE_DATA).map(
    (item, index) => ({
      ...item,
      fill: donutColors[index % donutColors.length],
    }),
  );
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          donut chart
        </Badge>
        <CardTitle>{title ?? "Donut Chart"}</CardTitle>
        <CardDescription>
          {summary ?? "Show a compact proportional breakdown."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[240px_1fr]">
        <ChartContainer
          config={toolUsageConfig}
          className="mx-auto aspect-square h-[220px]"
        >
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
  score: { label: "Score", color: CHART_SERIES.indigo },
} satisfies ChartConfig;

function CapabilityRadar({
  title,
  summary,
  data,
}: z.infer<typeof CapabilityRadarProps>) {
  const safeData = withFallbackArray(data, DEFAULT_RADAR_DATA);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          radar chart
        </Badge>
        <CardTitle>{title ?? "Radar Chart"}</CardTitle>
        <CardDescription>
          {summary ?? "Show capability coverage."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={radarConfig}
          className="mx-auto aspect-square max-h-[320px]"
        >
          <RadarChart data={safeData}>
            <ChartTooltip content={<ChartTooltipContent />} />
            <PolarAngleAxis dataKey="capability" />
            <PolarGrid />
            <Radar
              dataKey="score"
              fill={CHART_SERIES.indigo}
              fillOpacity={0.28}
              stroke={CHART_SERIES.indigo}
              strokeWidth={2}
            />
          </RadarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const radialConfig = {
  value: { label: "Value", color: CHART_SERIES.indigo },
} satisfies ChartConfig;

function ApprovalRadial({
  title,
  summary,
  metrics,
}: z.infer<typeof ApprovalRadialProps>) {
  const data = withFallbackArray(metrics, DEFAULT_RADIAL_METRICS).map(
    (metric, index) => ({
      ...metric,
      fill: donutColors[index % donutColors.length],
    }),
  );
  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          radial chart
        </Badge>
        <CardTitle>{title ?? "Radial Chart"}</CardTitle>
        <CardDescription>
          {summary ?? "Show progress toward readiness."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[220px_1fr]">
        <ChartContainer
          config={radialConfig}
          className="mx-auto aspect-square h-[220px]"
        >
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

function CalendarCard({
  title,
  summary,
  events,
}: z.infer<typeof CalendarComponentProps>) {
  const safeEvents = withFallbackArray(events, DEFAULT_TIMELINE_EVENTS);
  const selectedDates = safeEvents
    .map((event) => new Date(`${event.date}T12:00:00`))
    .filter((date) => !Number.isNaN(date.getTime()));
  const firstDate = selectedDates[0] ?? new Date();

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          calendar
        </Badge>
        <CardTitle>{title ?? "Calendar"}</CardTitle>
        <CardDescription>
          {summary ?? "Show relevant schedule points."}
        </CardDescription>
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
          {safeEvents.map((event) => (
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
  const safeChecks = withFallbackArray(checks, DEFAULT_APPROVAL_CHECKS);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          Approval form
        </Badge>
        <CardTitle>{title ?? "Approval Form"}</CardTitle>
        <CardDescription>
          {summary ?? "Preview approval readiness."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
          <Input
            readOnly
            value={command ?? "pnpm test"}
            aria-label="Approval command"
          />
          <Select value={risk ?? "medium"} disabled>
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
          {safeChecks.map((check) => (
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
  const safeFollowups = withFallbackArray(followups, DEFAULT_FOLLOWUPS);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          Handoff form
        </Badge>
        <CardTitle>{title ?? "Handoff Form"}</CardTitle>
        <CardDescription>
          {summary ?? "Capture handoff notes and follow-up items."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Input
          readOnly
          value={owner ?? "Demo presenter"}
          aria-label="Handoff owner"
        />
        <Textarea
          readOnly
          value={notes ?? "Summarize the completed run."}
          aria-label="Handoff notes"
        />
        <div className="grid gap-2">
          {safeFollowups.map((followup) => (
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
  const safeFiles = withFallbackArray(files, DEFAULT_FILE_IMPACTS);
  const data = safeFiles.map((file) => ({
    path: file.path,
    impact: file.risk === "high" ? 3 : file.risk === "medium" ? 2 : 1,
  }));
  const config = {
    impact: { label: "Impact", color: CHART_SERIES.indigo },
  } satisfies ChartConfig;

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          File impact
        </Badge>
        <CardTitle>{title ?? "File Impact Map"}</CardTitle>
        <CardDescription>
          {summary ?? "Show files inspected or changed."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChartContainer config={config} className="min-h-[180px]">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 16, right: 8 }}
          >
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
            <Bar dataKey="impact" fill={CHART_SERIES.indigo} radius={6} />
          </BarChart>
        </ChartContainer>
        <div className="grid gap-2">
          {safeFiles.map((file) => (
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
  const safeRows = withFallbackArray(rows, DEFAULT_RUN_HEALTH_ROWS);

  return (
    <Card className="my-4 max-w-3xl">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          run table
        </Badge>
        <CardTitle>{title ?? "Run Health Table"}</CardTitle>
        <CardDescription>
          {summary ?? "Show run checks and progress."}
        </CardDescription>
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
            {safeRows.map((row) => (
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
        <div key={label} className="rounded-lg border bg-background p-2">
          <div className="text-[10px] text-muted-foreground">{label}</div>
          <div className="text-sm font-semibold">{value}</div>
        </div>
      ))}
    </CatalogPreviewFrame>
  );
}

function BarChartPreview() {
  const data = [
    { label: "Alpha", value: 3 },
    { label: "Beta", value: 5 },
    { label: "Gamma", value: 4 },
  ];

  return (
    <CatalogPreviewFrame className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium">
          <ChartNoAxesCombined className="size-4 text-primary" />
          Bars
        </span>
        <span className="text-[10px] text-muted-foreground">3 values</span>
      </div>
      <ChartContainer
        config={barChartConfig}
        className="h-[104px] w-full min-w-0 aspect-auto"
      >
        <BarChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tickMargin={4}
            tick={{ fontSize: 10 }}
          />
          <YAxis hide domain={[0, 5]} />
          <Bar
            dataKey="value"
            fill={CHART_SERIES.blue}
            radius={[5, 5, 0, 0]}
            barSize={24}
          />
        </BarChart>
      </ChartContainer>
      <div className="text-[10px] text-muted-foreground">
        <LegendDot color={CHART_SERIES.blue} label="Value" />
      </div>
    </CatalogPreviewFrame>
  );
}

function LineChartPreview() {
  const data = [
    { label: "Jan", value: 12 },
    { label: "Feb", value: 18 },
    { label: "Mar", value: 16 },
    { label: "Apr", value: 24 },
  ];

  return (
    <CatalogPreviewFrame className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium">
          <ChartNoAxesCombined className="size-4 text-primary" />
          Line
        </span>
        <span className="text-[10px] text-muted-foreground">4 points</span>
      </div>
      <ChartContainer
        config={lineChartConfig}
        className="h-[104px] w-full min-w-0 aspect-auto"
      >
        <LineChart
          data={data}
          margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tickMargin={4}
            tick={{ fontSize: 10 }}
          />
          <YAxis hide domain={[0, 28]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_SERIES.indigo}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ChartContainer>
      <div className="text-[10px] text-muted-foreground">
        <LegendDot color={CHART_SERIES.indigo} label="Value" />
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
      className="h-[120px] w-full rounded-xl border bg-muted/20 p-2 aspect-auto"
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
          fill={CHART_SERIES.indigo}
          fillOpacity={0.35}
          stroke={CHART_SERIES.indigo}
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
      className="h-[120px] w-full rounded-xl border bg-muted/20 p-2 aspect-auto"
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
          fill={CHART_SERIES.indigo}
          fillOpacity={0.7}
          stroke={CHART_SERIES.indigo}
        />
        <Area
          dataKey="evidence"
          stackId="run"
          type="natural"
          fill={CHART_SERIES.blue}
          fillOpacity={0.55}
          stroke={CHART_SERIES.blue}
        />
        <Area
          dataKey="approvals"
          stackId="run"
          type="natural"
          fill={CHART_SERIES.mint}
          fillOpacity={0.45}
          stroke={CHART_SERIES.mint}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function ToolUsageDonutPreview() {
  const data = [
    { name: "Files", value: 4, fill: CHART_SERIES.blue },
    { name: "Shell", value: 2, fill: CHART_SERIES.indigo },
    { name: "Memory", value: 1, fill: CHART_SERIES.mint },
  ];
  return (
    <CatalogPreviewFrame className="grid gap-3 min-[460px]:grid-cols-[116px_minmax(0,1fr)]">
      <ChartContainer
        config={toolUsageConfig}
        className="aspect-square h-[116px] justify-self-center"
      >
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
      className="h-[150px] w-full rounded-xl border bg-muted/20 p-2 aspect-auto"
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
          fill={CHART_SERIES.indigo}
          fillOpacity={0.25}
          stroke={CHART_SERIES.indigo}
          strokeWidth={2}
        />
      </RadarChart>
    </ChartContainer>
  );
}

function ApprovalRadialPreview() {
  return (
    <CatalogPreviewFrame className="grid gap-3 min-[460px]:grid-cols-[116px_minmax(0,1fr)]">
      <ChartContainer
        config={radialConfig}
        className="aspect-square h-[116px] justify-self-center"
      >
        <RadialBarChart
          data={[
            { label: "Approval", value: 82, fill: CHART_SERIES.indigo },
            { label: "Tests", value: 64, fill: CHART_SERIES.blue },
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
          Show dated milestones, windows, and schedules.
        </div>
      </div>
    </CatalogPreviewFrame>
  );
}

function FileImpactPreview() {
  return (
    <CatalogPreviewFrame className="grid gap-2">
      {[
        ["src/metrics.ts", "medium"],
        ["data/revenue.csv", "low"],
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
