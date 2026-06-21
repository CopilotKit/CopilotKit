import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import type { BrowserContext, Frame, Page } from "playwright";
import { analyzePrTour, scopeReportToRows } from "./pr-tour-report";
import type { PrTourReport } from "./pr-tour-report";
import {
  buildDocsTourPlan,
  buildShowcaseTourPlan,
  DEFAULT_TOOL_RENDERING_TOUR_ROWS,
} from "./pr-tour-video-plan";
import type {
  DocsTourPlan,
  ShowcaseTourTopic,
  TourPrompt,
} from "./pr-tour-video-plan";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, ".artifacts", "pr-tour-videos");
const DEFAULT_SHELL_URL = "http://localhost:3000";
const DEFAULT_DASHBOARD_URL = "http://localhost:3002";
const DEFAULT_DOCS_URL = "http://localhost:3003";

interface CliArgs {
  mode: "showcase" | "docs" | "all" | "plan";
  base: string;
  head: string;
  rows: string[];
  columns: string[];
  outputDir: string;
  shellUrl: string;
  dashboardUrl: string;
  docsUrl: string;
  docsUrls: string[];
  promptLimit: number | null;
  perPromptWaitMs: number;
  smoke: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    mode: "all",
    base: "origin/main",
    head: "HEAD",
    rows: [...DEFAULT_TOOL_RENDERING_TOUR_ROWS],
    columns: [],
    outputDir: DEFAULT_OUTPUT_DIR,
    shellUrl: DEFAULT_SHELL_URL,
    dashboardUrl: DEFAULT_DASHBOARD_URL,
    docsUrl: DEFAULT_DOCS_URL,
    docsUrls: [],
    promptLimit: null,
    perPromptWaitMs: 10_000,
    smoke: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode") {
      const value = argv[++i];
      if (
        value === "showcase" ||
        value === "docs" ||
        value === "all" ||
        value === "plan"
      ) {
        args.mode = value;
      } else {
        throw new Error(`Unsupported --mode ${JSON.stringify(value)}`);
      }
    } else if (arg === "--preset") {
      const value = argv[++i];
      if (value !== "tool-rendering") {
        throw new Error(`Unsupported --preset ${JSON.stringify(value)}`);
      }
      args.rows = [...DEFAULT_TOOL_RENDERING_TOUR_ROWS];
    } else if (arg === "--base") args.base = argv[++i] ?? args.base;
    else if (arg === "--head") args.head = argv[++i] ?? args.head;
    else if (arg === "--rows") args.rows = splitCsv(argv[++i] ?? "");
    else if (arg === "--columns") args.columns = splitCsv(argv[++i] ?? "");
    else if (arg === "--output-dir")
      args.outputDir = path.resolve(argv[++i] ?? args.outputDir);
    else if (arg === "--shell-url")
      args.shellUrl = trimTrailingSlash(argv[++i] ?? args.shellUrl);
    else if (arg === "--dashboard-url")
      args.dashboardUrl = trimTrailingSlash(argv[++i] ?? args.dashboardUrl);
    else if (arg === "--docs-url")
      args.docsUrl = trimTrailingSlash(argv[++i] ?? args.docsUrl);
    else if (arg === "--docs-urls") args.docsUrls = splitCsv(argv[++i] ?? "");
    else if (arg === "--prompt-limit") {
      const value = Number.parseInt(argv[++i] ?? "", 10);
      if (Number.isNaN(value))
        throw new Error("--prompt-limit must be a number");
      args.promptLimit = value;
    } else if (arg === "--per-prompt-wait-ms") {
      const value = Number.parseInt(argv[++i] ?? "", 10);
      if (Number.isNaN(value))
        throw new Error("--per-prompt-wait-ms must be a number");
      args.perPromptWaitMs = value;
    } else if (arg === "--smoke") {
      args.smoke = true;
      args.rows = [args.rows[0] ?? DEFAULT_TOOL_RENDERING_TOUR_ROWS[0]];
      args.columns = [args.columns[0] ?? "langgraph-fastapi"];
      args.promptLimit = 1;
      args.perPromptWaitMs = 2_000;
    }
  }

  return args;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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

function buildReport(args: CliArgs): PrTourReport {
  const fullReport = analyzePrTour(changedFiles(args.base, args.head));
  return args.rows.length > 0
    ? scopeReportToRows(fullReport, args.rows)
    : fullReport;
}

async function assertReachable(url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function titleSlide(title: string, subtitle?: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #111827;
        color: #f9fafb;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(980px, calc(100vw - 96px));
      }
      p {
        margin: 0 0 16px;
        color: #c4b5fd;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 58px;
        line-height: 1;
      }
      h2 {
        margin: 20px 0 0;
        color: #d1d5db;
        font-size: 26px;
        font-weight: 500;
      }
    </style>
  </head>
  <body>
    <main>
      <p>CopilotKit PR Tour</p>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<h2>${escapeHtml(subtitle)}</h2>` : ""}
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function showTitle(
  page: Page,
  title: string,
  subtitle?: string,
): Promise<void> {
  await page.setContent(titleSlide(title, subtitle));
  await page.waitForTimeout(1_200);
}

async function findDemoFrame(page: Page): Promise<Frame | null> {
  const hasDemoIframe = await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll("iframe")).some((iframe) =>
          iframe.src.includes("/demos/"),
        ),
      { timeout: 8_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!hasDemoIframe) return null;

  for (let i = 0; i < 40; i++) {
    const frame = page
      .frames()
      .find((candidate) => candidate.url().includes("/demos/"));
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  return null;
}

async function submitPrompt(
  frame: Frame,
  prompt: TourPrompt,
): Promise<boolean> {
  if (prompt.source === "pill") {
    const pill = frame.getByText(prompt.title, { exact: true }).first();
    if (await pill.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await pill.click();
      return true;
    }
  }

  const textbox = frame
    .locator('textarea, [contenteditable="true"], input[type="text"]')
    .last();
  if (!(await textbox.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return false;
  }
  await textbox.fill(prompt.message);
  await textbox.press("Enter");
  return true;
}

async function recordTopic(
  topic: ShowcaseTourTopic,
  args: CliArgs,
): Promise<string> {
  fs.mkdirSync(path.dirname(topic.outputFile), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let videoPath = "";
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
      recordVideo: {
        dir: path.dirname(topic.outputFile),
        size: { width: 1440, height: 920 },
      },
    });
    const page = await context.newPage();
    await showTitle(
      page,
      topic.title,
      "Dashboard row, app behavior, and code walkthrough",
    );
    await page.goto(topic.dashboardUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);

    for (const cell of topic.cells) {
      await showTitle(
        page,
        cell.row.name,
        `${cell.column.name}: application interaction`,
      );
      process.stderr.write(`Recording ${cell.row.id} / ${cell.column.slug}\n`);
      await page.goto(cell.previewUrl, { waitUntil: "domcontentloaded" });
      const frame = await findDemoFrame(page);
      if (frame) {
        const prompts =
          args.promptLimit === null
            ? cell.prompts
            : cell.prompts.slice(0, args.promptLimit);
        for (const prompt of prompts) {
          const submitted = await submitPrompt(frame, prompt);
          await page.waitForTimeout(submitted ? args.perPromptWaitMs : 1_000);
        }
      } else {
        await page.waitForTimeout(2_000);
      }

      await showTitle(page, cell.row.name, `${cell.column.name}: code view`);
      await page.goto(cell.codeUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2_500);
    }

    videoPath = await closeAndSaveVideo(page, context, topic.outputFile);
  } finally {
    await browser.close();
  }
  return videoPath;
}

async function recordDocs(plan: DocsTourPlan): Promise<string> {
  fs.mkdirSync(path.dirname(plan.outputFile), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let videoPath = "";
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
      recordVideo: {
        dir: path.dirname(plan.outputFile),
        size: { width: 1440, height: 920 },
      },
    });
    const page = await context.newPage();
    await showTitle(
      page,
      plan.title,
      "Changed docs pages and changed sections",
    );
    for (const docsPage of plan.pages) {
      await showTitle(page, "Docs walkthrough", docsPage.url);
      await page.goto(docsPage.url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_500);
      if (docsPage.selectText) {
        await selectVisibleText(page, docsPage.selectText);
        await page.waitForTimeout(1_500);
      }
      await page.mouse.wheel(0, 650);
      await page.waitForTimeout(800);
    }
    videoPath = await closeAndSaveVideo(page, context, plan.outputFile);
  } finally {
    await browser.close();
  }
  return videoPath;
}

async function selectVisibleText(page: Page, needle: string): Promise<void> {
  await page.evaluate((text) => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const value = node.textContent ?? "";
      const index = value.indexOf(text);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const scrollTarget =
        node.parentNode instanceof Element ? node.parentNode : document.body;
      scrollTarget.scrollIntoView({
        block: "center",
        inline: "nearest",
      });
      return;
    }
  }, needle);
}

async function closeAndSaveVideo(
  page: Page,
  context: BrowserContext,
  targetPath: string,
): Promise<string> {
  const video = page.video();
  await page.close();
  await context.close();
  if (!video) {
    throw new Error("Playwright did not create a video for this page");
  }
  const actualPath = await video.path();
  fs.renameSync(actualPath, targetPath);
  return targetPath;
}

function writeManifest(outputDir: string, videos: readonly string[]): string {
  const manifestPath = path.join(outputDir, "README.md");
  const body = [
    "# PR Tour Videos",
    "",
    ...videos.map((video) => `- ${path.basename(video)}: ${video}`),
    "",
  ].join("\n");
  fs.writeFileSync(manifestPath, body);
  return manifestPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outputDir, { recursive: true });
  if (args.mode !== "plan") {
    if (args.mode === "showcase" || args.mode === "all") {
      await assertReachable(args.shellUrl);
      await assertReachable(args.dashboardUrl);
    }
    if (args.mode === "docs" || args.mode === "all") {
      await assertReachable(args.docsUrl);
    }
  }

  const report = buildReport(args);
  const topics = buildShowcaseTourPlan(report, {
    rows: args.rows,
    columns: args.columns,
    shellUrl: args.shellUrl,
    dashboardUrl: args.dashboardUrl,
    outputDir: args.outputDir,
  });
  const docsPlan = buildDocsTourPlan({
    docsUrl: args.docsUrl,
    urls: args.docsUrls,
    outputDir: args.outputDir,
  });

  if (args.mode === "plan") {
    process.stdout.write(
      `${JSON.stringify({ topics: summarizeTopics(topics), docsPlan }, null, 2)}\n`,
    );
    return;
  }

  const videos: string[] = [];
  if (args.mode === "showcase" || args.mode === "all") {
    for (const topic of topics) {
      videos.push(await recordTopic(topic, args));
    }
  }
  if (args.mode === "docs" || args.mode === "all") {
    videos.push(await recordDocs(docsPlan));
  }

  const manifestPath = writeManifest(args.outputDir, videos);
  process.stdout.write(
    [
      `Wrote ${videos.length} PR tour video${videos.length === 1 ? "" : "s"}:`,
      ...videos.map((video) => `  ${video}`),
      `Manifest: ${manifestPath}`,
      "",
    ].join("\n"),
  );
}

function summarizeTopics(topics: readonly ShowcaseTourTopic[]) {
  return topics.map((topic) => ({
    row: topic.row.id,
    title: topic.title,
    dashboardUrl: topic.dashboardUrl,
    outputFile: topic.outputFile,
    cells: topic.cells.map((cell) => ({
      column: cell.column.slug,
      previewUrl: cell.previewUrl,
      codeUrl: cell.codeUrl,
      codeTarget: cell.codeTarget
        ? {
            file: cell.codeTarget.file,
            lines: cell.codeTarget.lines,
            matchedNeedles: cell.codeTarget.matchedNeedles,
          }
        : null,
      prompts: cell.prompts.map((prompt) => ({
        title: prompt.title,
        source: prompt.source,
        message: prompt.message,
      })),
    })),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
