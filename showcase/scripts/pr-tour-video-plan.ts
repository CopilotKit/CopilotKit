import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  FeatureInfo,
  IntegrationInfo,
  PrTourReport,
} from "./pr-tour-report";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SHOWCASE_ROOT, "..");
const DEFAULT_SHELL_URL = "http://localhost:3000";
const DEFAULT_DASHBOARD_URL = "http://localhost:3002";
const DEFAULT_DOCS_URL = "http://localhost:3003";

export const DEFAULT_TOOL_RENDERING_TOUR_ROWS = [
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering-suppress-catchall",
  "tool-rendering-named-override",
] as const;

const TOOL_RENDERING_PILL_PROMPTS = [
  { title: "Weather in SF", message: "What's the weather in San Francisco?" },
  { title: "Find flights", message: "Find flights from SFO to JFK." },
  { title: "Roll a d20", message: "Roll a 20-sided die." },
  {
    title: "Chain tools",
    message:
      "Chain a few tools in this single turn: get the weather in Tokyo, search flights from SFO to Tokyo, and roll a d20.",
  },
] as const;

const TOOL_RENDERING_PLUS_STOCK_PILL_PROMPTS = [
  TOOL_RENDERING_PILL_PROMPTS[0],
  TOOL_RENDERING_PILL_PROMPTS[1],
  { title: "Stock price", message: "What's the current price of AAPL?" },
  TOOL_RENDERING_PILL_PROMPTS[2],
  TOOL_RENDERING_PILL_PROMPTS[3],
] as const;

const TOPIC_COPY: Record<string, string> = {
  "tool-rendering-default-catchall": "Tool rendering: built-in catch-all",
  "tool-rendering-custom-catchall": "Tool rendering: custom catch-all",
  "tool-rendering-suppress-catchall": "Tool rendering: suppress catch-all",
  "tool-rendering-named-override": "Tool rendering: named override",
};

const CUSTOM_PROMPT_BY_ROW: Record<string, string> = {
  "tool-rendering-default-catchall": "forecast for Tokyo",
  "tool-rendering-custom-catchall":
    "Forecast Tokyo through the wildcard renderer",
  "tool-rendering-suppress-catchall": "suppress catch-all weather case",
  "tool-rendering-named-override": "named override weather suppression case",
};

const CODE_NEEDLES_BY_ROW: Record<string, readonly string[]> = {
  "tool-rendering-default-catchall": [
    "useDefaultRenderTool();",
    'agent="tool-rendering-default-catchall"',
  ],
  "tool-rendering-custom-catchall": [
    "useDefaultRenderTool(",
    "render: ({ name, parameters, status, result }) => (",
    "<CustomCatchallRenderer",
  ],
  "tool-rendering-suppress-catchall": [
    'import { useDefaultRenderTool } from "@copilotkit/react-core/v2";',
    "useDefaultRenderTool({",
    "render: ({ name, parameters, status, result }) => null,",
  ],
  "tool-rendering-named-override": [
    'import { useRenderTool } from "@copilotkit/react-core/v2";',
    "useRenderTool(",
    "render: ({ name, parameters, status, result }) => null,",
  ],
};

export interface TourPrompt {
  title: string;
  message: string;
  source: "pill" | "custom";
}

export interface CodeTarget {
  file: string;
  lines: string;
  codeUrl: string;
  matchedNeedles: string[];
}

export interface ShowcaseTourCell {
  column: IntegrationInfo;
  row: FeatureInfo;
  previewUrl: string;
  codeUrl: string;
  codeTarget: CodeTarget | null;
  prompts: TourPrompt[];
}

export interface ShowcaseTourTopic {
  row: FeatureInfo;
  title: string;
  dashboardUrl: string;
  outputFile: string;
  cells: ShowcaseTourCell[];
}

export interface DocsTourPage {
  url: string;
  selectText: string | null;
}

export interface DocsTourPlan {
  title: string;
  outputFile: string;
  pages: DocsTourPage[];
}

export interface ShowcaseTourPlanOptions {
  shellUrl?: string;
  dashboardUrl?: string;
  outputDir?: string;
  rows?: readonly string[];
  columns?: readonly string[];
  directPreviewBaseUrls?: Readonly<Record<string, string>>;
}

export interface DocsTourPlanOptions {
  outputDir?: string;
  docsUrl?: string;
  urls?: readonly string[];
}

interface DemoContentFile {
  filename: string;
  content: string;
  highlighted?: boolean;
}

interface DemoContent {
  files: DemoContentFile[];
  backend_files?: DemoContentFile[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readDemoContent(): Record<string, DemoContent> {
  const contentPath = path.join(
    SHOWCASE_ROOT,
    "shell",
    "src",
    "data",
    "demo-content.json",
  );
  if (!fs.existsSync(contentPath)) return {};
  return JSON.parse(fs.readFileSync(contentPath, "utf8")).demos ?? {};
}

function promptSetForRow(rowId: string): TourPrompt[] {
  const pillPrompts =
    rowId === "tool-rendering-named-override"
      ? TOOL_RENDERING_PLUS_STOCK_PILL_PROMPTS
      : TOOL_RENDERING_PILL_PROMPTS;
  return [
    ...pillPrompts.map((prompt) => ({ ...prompt, source: "pill" as const })),
    {
      title: "Custom prompt",
      message:
        CUSTOM_PROMPT_BY_ROW[rowId] ??
        "Try the changed showcase behavior with a prompt that is not one of the suggestion pills.",
      source: "custom" as const,
    },
  ];
}

function lineRangeForNeedles(
  content: string,
  needles: readonly string[],
): { lines: string; matchedNeedles: string[] } | null {
  const lines = content.split(/\r?\n/);
  const matchedLines: number[] = [];
  const matchedNeedles: string[] = [];

  for (const needle of needles) {
    const index = lines.findIndex((line) => line.includes(needle));
    if (index >= 0) {
      matchedLines.push(index + 1);
      matchedNeedles.push(needle);
    }
  }

  if (matchedLines.length === 0) return null;
  const start = Math.max(1, Math.min(...matchedLines) - 1);
  const end = Math.min(lines.length, Math.max(...matchedLines) + 4);
  return { lines: `${start}-${end}`, matchedNeedles };
}

function findCodeTarget(
  shellUrl: string,
  slug: string,
  rowId: string,
  demoContent: Record<string, DemoContent>,
): CodeTarget | null {
  const content = demoContent[`${slug}::${rowId}`];
  if (!content) return null;
  const files = [...content.files, ...(content.backend_files ?? [])];
  const needles = CODE_NEEDLES_BY_ROW[rowId] ?? [];

  const candidateFiles = [
    ...files.filter((file) => file.highlighted),
    ...files.filter((file) => !file.highlighted),
  ];

  for (const file of candidateFiles) {
    const match = lineRangeForNeedles(file.content, needles);
    if (!match) continue;
    const params = new URLSearchParams({
      file: file.filename,
      lines: match.lines,
    });
    return {
      file: file.filename,
      lines: match.lines,
      codeUrl: `${shellUrl}/integrations/${slug}/${rowId}/code?${params.toString()}`,
      matchedNeedles: match.matchedNeedles,
    };
  }

  const fallback = candidateFiles[0];
  if (!fallback) return null;
  const params = new URLSearchParams({ file: fallback.filename });
  return {
    file: fallback.filename,
    lines: "",
    codeUrl: `${shellUrl}/integrations/${slug}/${rowId}/code?${params.toString()}`,
    matchedNeedles: [],
  };
}

export function buildShowcaseTourPlan(
  report: PrTourReport,
  options: ShowcaseTourPlanOptions = {},
): ShowcaseTourTopic[] {
  const shellUrl = options.shellUrl ?? DEFAULT_SHELL_URL;
  const dashboardUrl = options.dashboardUrl ?? DEFAULT_DASHBOARD_URL;
  const outputDir =
    options.outputDir ?? path.join(REPO_ROOT, ".artifacts", "pr-tour-videos");
  const requestedRows = new Set(
    options.rows ?? report.rows.map((row) => row.id),
  );
  const requestedColumns =
    options.columns && options.columns.length > 0
      ? new Set(options.columns)
      : null;
  const demoContent = readDemoContent();

  return report.rows
    .filter((row) => requestedRows.has(row.id))
    .map((row) => {
      const cells = report.cells
        .filter((cell) => cell.row.id === row.id)
        .filter((cell) =>
          requestedColumns ? requestedColumns.has(cell.column.slug) : true,
        )
        .map((cell) => {
          const baseCodeUrl = `${shellUrl}/integrations/${cell.column.slug}/${row.id}/code`;
          const codeTarget = findCodeTarget(
            shellUrl,
            cell.column.slug,
            row.id,
            demoContent,
          );
          return {
            column: cell.column,
            row,
            previewUrl:
              options.directPreviewBaseUrls?.[cell.column.slug] !== undefined
                ? `${options.directPreviewBaseUrls[cell.column.slug]}/demos/${row.id}`
                : `${shellUrl}/integrations/${cell.column.slug}/${row.id}/preview`,
            codeUrl: codeTarget?.codeUrl ?? baseCodeUrl,
            codeTarget,
            prompts: promptSetForRow(row.id),
          };
        });
      const rowsQuery = encodeURIComponent(row.id);
      return {
        row,
        title: TOPIC_COPY[row.id] ?? row.name,
        dashboardUrl: `${dashboardUrl}/?rows=${rowsQuery}#matrix:links,depth,health,parity`,
        outputFile: path.join(outputDir, `${slugify(row.id)}.webm`),
        cells,
      };
    });
}

export function defaultDocsTourUrls(docsUrl = DEFAULT_DOCS_URL): string[] {
  return [
    `${docsUrl}/generative-ui/tool-rendering`,
    `${docsUrl}/generative-ui/tool-rendering/custom`,
    `${docsUrl}/generative-ui/tool-rendering/catch-all`,
    `${docsUrl}/langgraph-python/generative-ui/tool-rendering/custom`,
    `${docsUrl}/langgraph-python/generative-ui/tool-rendering/catch-all`,
    `${docsUrl}/mastra/generative-ui/tool-rendering/custom`,
    `${docsUrl}/mastra/generative-ui/tool-rendering/catch-all`,
    `${docsUrl}/ms-agent-python/generative-ui/tool-rendering/catch-all`,
  ];
}

function selectionNeedleForDocsUrl(url: string): string | null {
  if (url.endsWith("/catch-all")) return "Render nothing from the catch-all";
  if (url.endsWith("/custom")) return "Render tool calls in your UI";
  if (url.endsWith("/tool-rendering")) return "Catch-all Tool Rendering";
  return null;
}

export function buildDocsTourPlan(
  options: DocsTourPlanOptions = {},
): DocsTourPlan {
  const docsUrl = options.docsUrl ?? DEFAULT_DOCS_URL;
  const outputDir =
    options.outputDir ?? path.join(REPO_ROOT, ".artifacts", "pr-tour-videos");
  const urls =
    options.urls && options.urls.length > 0
      ? options.urls
      : defaultDocsTourUrls(docsUrl);
  return {
    title: "Docs walkthrough: tool rendering",
    outputFile: path.join(outputDir, "docs-tool-rendering.webm"),
    pages: urls.map((url) => ({
      url,
      selectText: selectionNeedleForDocsUrl(url),
    })),
  };
}
