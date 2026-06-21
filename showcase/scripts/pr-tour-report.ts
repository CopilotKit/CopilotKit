import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SHOWCASE_ROOT, "..");
const LOCAL_DASHBOARD_URL = "http://localhost:3002";
const LOCAL_DOCS_URL = "http://localhost:3003";

interface FeatureInfo {
  id: string;
  name: string;
}

interface DemoInfo {
  id: string;
  route?: string;
  highlight: string[];
}

interface IntegrationInfo {
  slug: string;
  name: string;
  sortOrder: number;
  demos: DemoInfo[];
}

export interface PrTourReport {
  rows: FeatureInfo[];
  columns: IntegrationInfo[];
  cells: { row: FeatureInfo; column: IntegrationInfo }[];
  docsUrls: string[];
  docsFiles: string[];
  globalFiles: string[];
  dashboardUrl: string | null;
}

function repoRelative(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function loadFeatures(): FeatureInfo[] {
  const registry = readJson<{ features: FeatureInfo[] }>(
    path.join(SHOWCASE_ROOT, "shared", "feature-registry.json"),
  );
  return registry.features;
}

function loadIntegrations(): IntegrationInfo[] {
  const integrationsDir = path.join(SHOWCASE_ROOT, "integrations");
  return fs
    .readdirSync(integrationsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(integrationsDir, entry.name, "manifest.yaml")),
    )
    .map((entry) => {
      const manifestPath = path.join(
        integrationsDir,
        entry.name,
        "manifest.yaml",
      );
      const raw = yaml.parse(fs.readFileSync(manifestPath, "utf8")) as {
        slug?: string;
        name?: string;
        sort_order?: number;
        demos?: {
          id?: string;
          route?: string;
          highlight?: string[];
          source_files?: string[];
        }[];
      };
      return {
        slug: raw.slug ?? entry.name,
        name: raw.name ?? raw.slug ?? entry.name,
        sortOrder: raw.sort_order ?? 999,
        demos: (raw.demos ?? [])
          .filter((demo) => typeof demo.id === "string")
          .map((demo) => ({
            id: demo.id as string,
            route: demo.route,
            highlight: [
              ...(demo.highlight ?? []),
              ...(demo.source_files ?? []),
            ],
          })),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}

function changedFiles(base: string, head: string): string[] {
  return execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function demoDirectory(slug: string, demo: DemoInfo): string | null {
  if (!demo.route?.startsWith("/demos/")) return null;
  return `showcase/integrations/${slug}/src/app${demo.route}/`;
}

function exactDemoFiles(slug: string, demo: DemoInfo): string[] {
  const files = demo.highlight.map(
    (highlightPath) => `showcase/integrations/${slug}/${highlightPath}`,
  );
  files.push(`showcase/integrations/${slug}/tests/e2e/${demo.id}.spec.ts`);
  files.push(`showcase/integrations/${slug}/qa/${demo.id}.md`);
  files.push(`showcase/aimock/d6/${slug}/${demo.id}.json`);
  files.push(`showcase/harness/fixtures/d5/${demo.id}.json`);
  return files.map(repoRelative);
}

function matchesDemoFile(
  filePath: string,
  slug: string,
  demo: DemoInfo,
): boolean {
  const exact = new Set(exactDemoFiles(slug, demo));
  if (exact.has(filePath)) return true;

  const directory = demoDirectory(slug, demo);
  return directory !== null && filePath.startsWith(directory);
}

function docsUrlForFile(filePath: string): string | null {
  const prefix = "showcase/shell-docs/src/content/docs/";
  if (!filePath.startsWith(prefix) || !filePath.endsWith(".mdx")) return null;

  let route = filePath.slice(prefix.length, -".mdx".length);
  if (route.endsWith("/index")) route = route.slice(0, -"/index".length);

  if (route.startsWith("integrations/")) {
    route = route.slice("integrations/".length);
  }

  return `${LOCAL_DOCS_URL}/${route}`;
}

function featureFromHarnessPath(filePath: string): string | null {
  const scriptMatch = filePath.match(
    /^showcase\/harness\/src\/probes\/scripts\/d5-(.+?)(?:\.test)?\.ts$/,
  );
  if (scriptMatch) return scriptMatch[1];

  const fixtureMatch = filePath.match(
    /^showcase\/harness\/fixtures\/d5\/(.+)\.json$/,
  );
  if (fixtureMatch) return fixtureMatch[1];

  return null;
}

export function analyzePrTour(
  files: readonly string[],
  features: readonly FeatureInfo[] = loadFeatures(),
  integrations: readonly IntegrationInfo[] = loadIntegrations(),
): PrTourReport {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const integrationBySlug = new Map(
    integrations.map((integration) => [integration.slug, integration]),
  );
  const rows = new Set<string>();
  const columns = new Set<string>();
  const cellKeys = new Set<string>();
  const docsUrls = new Set<string>();
  const docsFiles = new Set<string>();
  const globalFiles = new Set<string>();

  for (const filePath of files.map(repoRelative)) {
    const docsUrl = docsUrlForFile(filePath);
    if (docsUrl) {
      docsUrls.add(docsUrl);
      docsFiles.add(filePath);
      continue;
    }
    if (filePath.startsWith("showcase/shell-docs/src/content/snippets/")) {
      docsFiles.add(filePath);
      continue;
    }

    const harnessFeature = featureFromHarnessPath(filePath);
    if (harnessFeature && featureById.has(harnessFeature)) {
      rows.add(harnessFeature);
      continue;
    }

    let matched = false;
    for (const integration of integrations) {
      const integrationPrefix = `showcase/integrations/${integration.slug}/`;
      if (!filePath.startsWith(integrationPrefix)) continue;

      columns.add(integration.slug);
      for (const demo of integration.demos) {
        if (!featureById.has(demo.id)) continue;
        if (matchesDemoFile(filePath, integration.slug, demo)) {
          rows.add(demo.id);
          cellKeys.add(`${integration.slug}\u0000${demo.id}`);
          matched = true;
        }
      }
      if (!matched) globalFiles.add(filePath);
    }

    const d6Match = filePath.match(
      /^showcase\/aimock\/d6\/([^/]+)\/(.+)\.json$/,
    );
    if (d6Match) {
      const [, slug, featureId] = d6Match;
      if (integrationBySlug.has(slug)) columns.add(slug);
      if (featureById.has(featureId)) {
        rows.add(featureId);
        cellKeys.add(`${slug}\u0000${featureId}`);
      }
      continue;
    }

    if (
      filePath === "showcase/shared/feature-registry.json" ||
      filePath === "showcase/shared/constraints.yaml"
    ) {
      globalFiles.add(filePath);
    }
  }

  const orderedRows = features.filter((feature) => rows.has(feature.id));
  const orderedColumns = integrations.filter((integration) =>
    columns.has(integration.slug),
  );
  const cells = [...cellKeys]
    .map((key) => {
      const [columnSlug, rowId] = key.split("\u0000");
      const column = integrationBySlug.get(columnSlug);
      const row = featureById.get(rowId);
      return column && row ? { column, row } : null;
    })
    .filter((cell): cell is { row: FeatureInfo; column: IntegrationInfo } =>
      Boolean(cell),
    )
    .sort((a, b) => {
      const rowDelta =
        features.findIndex((feature) => feature.id === a.row.id) -
        features.findIndex((feature) => feature.id === b.row.id);
      if (rowDelta !== 0) return rowDelta;
      return a.column.sortOrder - b.column.sortOrder;
    });

  const dashboardUrl =
    orderedRows.length > 0
      ? `${LOCAL_DASHBOARD_URL}/?rows=${orderedRows
          .map((row) => encodeURIComponent(row.id))
          .join(",")}#matrix:links,depth,health,parity`
      : null;

  return {
    rows: orderedRows,
    columns: orderedColumns,
    cells,
    docsUrls: [...docsUrls].sort(),
    docsFiles: [...docsFiles].sort(),
    globalFiles: [...globalFiles].sort(),
    dashboardUrl,
  };
}

export function scopeReportToRows(
  report: PrTourReport,
  rowIds: readonly string[],
  features: readonly FeatureInfo[] = loadFeatures(),
): PrTourReport {
  const requested = new Set(rowIds);
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const rows = features.filter((feature) => requested.has(feature.id));
  for (const id of rowIds) {
    if (!featureById.has(id)) {
      throw new Error(`Unknown dashboard row ${JSON.stringify(id)}`);
    }
  }

  const cells = report.cells.filter((cell) => requested.has(cell.row.id));
  const columnSlugs = new Set(cells.map((cell) => cell.column.slug));
  const columns = report.columns.filter((column) =>
    columnSlugs.has(column.slug),
  );
  const dashboardUrl =
    rows.length > 0
      ? `${LOCAL_DASHBOARD_URL}/?rows=${rows
          .map((row) => encodeURIComponent(row.id))
          .join(",")}#matrix:links,depth,health,parity`
      : null;

  return {
    ...report,
    rows,
    columns,
    cells,
    dashboardUrl,
  };
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return "- None detected";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatCells(report: PrTourReport): string {
  if (report.cells.length === 0) return "- None detected";

  const expected = new Set<string>();
  for (const row of report.rows) {
    for (const column of report.columns) {
      expected.add(`${column.slug}\u0000${row.id}`);
    }
  }
  const actual = new Set(
    report.cells.map((cell) => `${cell.column.slug}\u0000${cell.row.id}`),
  );
  const completeCrossProduct =
    expected.size > 0 &&
    expected.size === actual.size &&
    [...expected].every((key) => actual.has(key));

  if (completeCrossProduct) {
    return `- All listed rows across all listed columns (${actual.size} cells).`;
  }

  return formatList(
    report.cells.map((cell) => `${cell.column.slug} × ${cell.row.id}`),
  );
}

export function formatMarkdown(report: PrTourReport): string {
  const rows = report.rows.map((row) => `${row.id} — ${row.name}`);
  const columns = report.columns.map(
    (column) => `${column.slug} — ${column.name}`,
  );

  return [
    "## PR Tour",
    "",
    report.dashboardUrl
      ? `Dashboard row-filtered matrix: ${report.dashboardUrl}`
      : "Dashboard row-filtered matrix: No showcase rows detected.",
    "",
    "### Showcase Items Changed",
    "",
    "Rows changed:",
    formatList(rows),
    "",
    "Columns changed:",
    formatList(columns),
    "",
    "Cells detected:",
    formatCells(report),
    "",
    "Global / ambiguous showcase files:",
    formatList(report.globalFiles),
    "",
    "### Docs Changed",
    "",
    "Doc URLs:",
    formatList(report.docsUrls),
    "",
    "Doc source files:",
    formatList(report.docsFiles),
  ].join("\n");
}

function parseArgs(argv: readonly string[]): {
  base: string;
  head: string;
  format: "markdown" | "json";
  rows: string[];
} {
  let base = "origin/main";
  let head = "HEAD";
  let format: "markdown" | "json" = "markdown";
  let rows: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") base = argv[++i] ?? base;
    else if (arg === "--head") head = argv[++i] ?? head;
    else if (arg === "--format") {
      const next = argv[++i];
      if (next === "json" || next === "markdown") format = next;
      else throw new Error(`Unsupported --format ${JSON.stringify(next)}`);
    } else if (arg === "--rows") {
      rows = (argv[++i] ?? "")
        .split(",")
        .map((row) => row.trim())
        .filter(Boolean);
    }
  }

  return { base, head, format, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const fullReport = analyzePrTour(changedFiles(args.base, args.head));
  const report =
    args.rows.length > 0
      ? scopeReportToRows(fullReport, args.rows)
      : fullReport;
  process.stdout.write(
    args.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatMarkdown(report)}\n`,
  );
}
