// @region[browse-web-tool]
// Local-browser navigation tool for the Mastra Browser Use demo (OSS-91).
//
// This is a DEMO-LEVEL build: Mastra ships first-class browser agents, but
// the CopilotKit runtime has no browser handling of its own, so the browsing
// itself is a plain Playwright tool the agent calls. Crucially it uses a
// LOCAL headless Chromium — NOT a hosted browser API (Browserbase et al.) —
// so no third-party key is required to run the cell.
//
// Runtime requirement: `playwright` needs its Chromium binary installed once
// via `npx playwright install chromium`. If Chromium is missing (or a launch
// otherwise fails), `browse_web` returns a structured `{ error }` payload
// rather than throwing — the agent then summarizes the failure to the user
// and the run completes cleanly instead of crashing.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Browser } from "playwright";

const MAX_RESULTS = 10;

/** One extracted result — a link/story or a page-text excerpt. */
export interface BrowseResult {
  title: string;
  url?: string;
  points?: number;
  source?: string;
}

export interface BrowseWebResult {
  task: string;
  mode: "hackernews" | "page";
  url: string;
  results: BrowseResult[];
  text?: string;
  error?: string;
}

const HN_URL = "https://news.ycombinator.com/";

/**
 * Decide what to browse from the free-text task. Keep this dead simple: the
 * demo only needs the two canonical flows (top HN stories, or "read this
 * page"). Anything with an explicit http(s) URL is treated as a page read;
 * a mention of hacker news / HN routes to the HN scraper; otherwise we
 * default to HN so a bare "what's trending" still does something useful.
 */
function planBrowse(task: string): {
  mode: "hackernews" | "page";
  url: string;
} {
  const urlMatch = task.match(/https?:\/\/[^\s"'<>)]+/i);
  if (urlMatch) {
    return { mode: "page", url: urlMatch[0] };
  }
  return { mode: "hackernews", url: HN_URL };
}

/**
 * Launch a local headless Chromium. Isolated so the failure mode (missing
 * browser binary) is easy to catch and translate into a friendly error.
 */
async function launchLocalChromium(): Promise<Browser> {
  // Lazy import so a missing `playwright` install surfaces as a caught error
  // in `execute` rather than a module-load crash for the whole route.
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

async function scrapeHackerNews(browser: Browser): Promise<BrowseResult[]> {
  const page = await browser.newPage();
  try {
    await page.goto(HN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // HN markup: each story title lives in `.titleline > a`; the score sits
    // in the following sub-row under `.subline > .score`.
    const rows = await page.locator("tr.athing").all();
    const results: BrowseResult[] = [];
    for (const row of rows.slice(0, MAX_RESULTS)) {
      const link = row.locator(".titleline > a").first();
      const title = (await link.textContent())?.trim() ?? "";
      const url = (await link.getAttribute("href")) ?? undefined;
      if (!title) continue;
      // Score is in the sibling row; grab it best-effort.
      let points: number | undefined;
      try {
        const sub = row.locator("xpath=following-sibling::tr[1]");
        const scoreText = (
          await sub.locator(".score").first().textContent({ timeout: 1_000 })
        )?.trim();
        const n = scoreText ? parseInt(scoreText, 10) : NaN;
        points = Number.isNaN(n) ? undefined : n;
      } catch {
        points = undefined;
      }
      results.push({ title, url, points, source: "Hacker News" });
    }
    return results;
  } finally {
    await page.close();
  }
}

async function readPage(
  browser: Browser,
  url: string,
): Promise<{ results: BrowseResult[]; text: string }> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const title = (await page.title())?.trim() || url;
    // Pull a bounded chunk of visible body text so the agent can summarize
    // it without us shipping the whole DOM back through the model.
    const bodyText =
      (await page
        .locator("body")
        .innerText({ timeout: 10_000 })
        .catch(() => "")) || "";
    const text = bodyText.replace(/\s+/g, " ").trim().slice(0, 4_000);
    return {
      results: [{ title, url, source: new URL(url).hostname }],
      text,
    };
  } finally {
    await page.close();
  }
}

export const browseWebTool = createTool({
  id: "browse_web",
  description:
    "Browse the live web with a real local browser. Given a task, either " +
    "fetch the current top Hacker News stories, or open a specific URL and " +
    "extract its title + main text. Returns structured results to summarize.",
  inputSchema: z.object({
    task: z
      .string()
      .describe(
        "What to browse, e.g. 'top Hacker News stories' or 'read https://www.copilotkit.ai'",
      ),
  }),
  // Return the OBJECT, not a JSON string. The @ag-ui/mastra bridge encodes the
  // tool result exactly once on its way to the frontend; if we stringify here
  // too, the render receives a DOUBLE-encoded string, `parseJsonResult` parses
  // one level back to a string, `.results` is undefined, and BrowseResultsCard
  // shows "0 results" even though the browse succeeded (the LLM still reads the
  // stringified content fine, so the chat text is correct — only the card is
  // starved). Single-encode by returning the object. See the Mastra
  // capability-map memory ("return a parsed OBJECT (single-encode)").
  execute: async ({ task }): Promise<BrowseWebResult> => {
    const plan = planBrowse(task);
    let browser: Browser | undefined;
    try {
      browser = await launchLocalChromium();
      if (plan.mode === "hackernews") {
        const results = await scrapeHackerNews(browser);
        return {
          task,
          mode: "hackernews",
          url: plan.url,
          results,
        };
      }
      const { results, text } = await readPage(browser, plan.url);
      return {
        task,
        mode: "page",
        url: plan.url,
        results,
        text,
      };
    } catch (err) {
      // Never crash the agent run. The most common cause is a missing
      // Chromium binary ("Executable doesn't exist ... run: npx playwright
      // install"). Surface it as a structured error the agent can relay.
      const message = err instanceof Error ? err.message : String(err);
      const hint = /Executable doesn't exist|install/i.test(message)
        ? " (the local Chromium binary may be missing — run `npx playwright install chromium`)"
        : "";
      return {
        task,
        mode: plan.mode,
        url: plan.url,
        results: [],
        error: `Local browser navigation failed: ${message}${hint}`,
      };
    } finally {
      await browser?.close().catch(() => {});
    }
  },
});
// @endregion[browse-web-tool]
