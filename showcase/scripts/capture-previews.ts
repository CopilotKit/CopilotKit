/**
 * Capture animated preview GIFs for ALL showcase integration demos.
 *
 * Reads manifest.yaml from each deployed package, builds the full list of
 * {integration, demo, backendUrl} tuples, then uses Playwright to navigate,
 * interact, record video, and convert to optimized GIFs via ffmpeg.
 *
 * Usage:
 *   npx tsx showcase/scripts/capture-previews.ts
 *   npx tsx showcase/scripts/capture-previews.ts --slug langgraph-python
 *   npx tsx showcase/scripts/capture-previews.ts --demo agentic-chat
 *   npx tsx showcase/scripts/capture-previews.ts --concurrency 5
 *
 * Requires: playwright (installed in showcase/tests/), ffmpeg, yaml
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VIEWPORT = { width: 800, height: 600 };
const GIF_WIDTH = 400;
const GIF_FPS = 10;
const RESPONSE_TIMEOUT = 45_000;
const POST_RESPONSE_WAIT = 3_000;

const PACKAGES_DIR = path.resolve(__dirname, "..", "packages");
const PREVIEWS_DIR = path.resolve(
  __dirname,
  "..",
  "shell",
  "public",
  "previews",
);
const VIDEO_DIR = path.resolve(PREVIEWS_DIR, "_videos");

// ---------------------------------------------------------------------------
// Demo-specific prompts
// ---------------------------------------------------------------------------

interface DemoConfig {
  prompt: string;
  /** Extra interaction after assistant responds (e.g., click Approve) */
  postResponse?: (page: import("playwright").Page) => Promise<void>;
  /** Extra wait time in ms after all interactions (default: POST_RESPONSE_WAIT) */
  extraWait?: number;
}

const DEMO_CONFIGS: Record<string, DemoConfig> = {
  "agentic-chat": {
    prompt: "Change the background to a warm sunset gradient",
    // Wait extra for the background CSS transition to complete
    extraWait: 4_000,
  },
  "tool-rendering": {
    prompt: "What's the weather like in San Francisco?",
    // Weather card renders inline — default wait is fine
  },
  hitl: {
    prompt: "Please plan a trip to mars in 5 steps",
    // The interesting part of HITL is the step review UI appearing — we give extra time
    // for the agent to generate the plan and the step list to render
    extraWait: 8_000,
  },
  "gen-ui-tool-based": {
    prompt: "What's the weather forecast for Tokyo?",
  },
  "gen-ui-agent": {
    prompt: "Show me the weather in San Francisco",
  },
  "shared-state-read": {
    prompt: "What tasks are currently on my todo list?",
  },
  "shared-state-write": {
    prompt: "Add a task to buy groceries for dinner",
    postResponse: async (page) => {
      // Wait for the todo list UI to update with the new item
      try {
        await page.waitForFunction(
          () => {
            // Look for common todo list patterns: li elements, checkbox items, etc.
            const items = document.querySelectorAll(
              'li, [role="listitem"], [data-testid*="todo"], [data-testid*="task"]',
            );
            return items.length > 0;
          },
          { timeout: 10_000 },
        );
      } catch {
        console.log(
          "    [WARN] Could not detect todo list update for shared-state-write",
        );
      }
    },
    extraWait: 2_000,
  },
  "shared-state-streaming": {
    prompt: "Add three tasks for planning a birthday party",
    // Give extra time for streaming state updates to render
    extraWait: 8_000,
  },
  subagents: {
    prompt: "What's the weather like in San Francisco today?",
    // Multi-agent responses take longer
    extraWait: 5_000,
  },
};

const DEFAULT_CONFIG: DemoConfig = {
  prompt: "Hello! What can you help me with?",
};

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

function parseArgs(): { slug?: string; demo?: string; concurrency: number } {
  const args = process.argv.slice(2);
  let slug: string | undefined;
  let demo: string | undefined;
  let concurrency = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) {
      slug = args[++i];
    } else if (args[i] === "--demo" && args[i + 1]) {
      demo = args[++i];
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = parseInt(args[++i], 10) || 3;
    }
  }

  return { slug, demo, concurrency };
}

// ---------------------------------------------------------------------------
// Manifest reading
// ---------------------------------------------------------------------------

interface DemoEntry {
  id: string;
  name: string;
  route: string;
}

interface Manifest {
  slug: string;
  name: string;
  backend_url: string;
  deployed: boolean;
  demos: DemoEntry[];
}

interface CaptureTarget {
  integrationSlug: string;
  integrationName: string;
  backendUrl: string;
  demoId: string;
  demoRoute: string;
}

function readAllManifests(): Manifest[] {
  const manifests: Manifest[] = [];
  const packageDirs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of packageDirs) {
    const manifestPath = path.join(PACKAGES_DIR, dir, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const parsed = YAML.parse(raw) as Manifest;
      if (parsed.slug && parsed.demos && Array.isArray(parsed.demos)) {
        manifests.push(parsed);
      }
    } catch (err) {
      console.warn(`  [WARN] Failed to parse ${manifestPath}: ${err}`);
    }
  }

  return manifests;
}

function buildTargets(
  manifests: Manifest[],
  filterSlug?: string,
  filterDemo?: string,
): CaptureTarget[] {
  const targets: CaptureTarget[] = [];

  for (const m of manifests) {
    if (!m.deployed) {
      console.log(`  [SKIP] ${m.slug} — not deployed`);
      continue;
    }
    if (filterSlug && m.slug !== filterSlug) {
      continue;
    }

    for (const demo of m.demos) {
      if (filterDemo && demo.id !== filterDemo) {
        continue;
      }
      targets.push({
        integrationSlug: m.slug,
        integrationName: m.name,
        backendUrl: m.backend_url,
        demoId: demo.id,
        demoRoute: demo.route,
      });
    }
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Capture logic
// ---------------------------------------------------------------------------

interface CaptureResult {
  integrationSlug: string;
  demoId: string;
  success: boolean;
  error?: string;
  gifPath?: string;
  gifSize?: number;
}

async function captureDemo(
  browser: Browser,
  target: CaptureTarget,
): Promise<CaptureResult> {
  const demoUrl = `${target.backendUrl}${target.demoRoute}`;
  const label = `${target.integrationSlug}/${target.demoId}`;
  console.log(`\n--- Capturing ${label} (${demoUrl}) ---`);

  // Per-integration video subdir to avoid collisions in parallel
  const videoSubDir = path.join(
    VIDEO_DIR,
    `${target.integrationSlug}_${target.demoId}_${Date.now()}`,
  );
  fs.mkdirSync(videoSubDir, { recursive: true });

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: {
        dir: videoSubDir,
        size: VIEWPORT,
      },
    });

    const page = await context.newPage();

    // Navigate to the demo
    await page.goto(demoUrl, { waitUntil: "networkidle", timeout: 30_000 });

    // Wait for chat textarea
    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 15_000 });

    // Brief pause so the page is fully rendered before typing
    await page.waitForTimeout(1_000);

    // Count existing assistant messages
    const messagesBefore = await page
      .locator('[data-testid="copilot-assistant-message"]')
      .count();

    // Get demo-specific config
    const config = DEMO_CONFIGS[target.demoId] ?? DEFAULT_CONFIG;
    const { prompt } = config;

    // Type the message and send
    await textarea.fill(prompt);
    await page.waitForTimeout(500);
    await textarea.press("Enter");

    // Wait for a new assistant message
    try {
      await page.waitForFunction(
        ({ selector, countBefore }) => {
          const msgs = document.querySelectorAll(selector);
          return msgs.length > countBefore;
        },
        {
          selector: '[data-testid="copilot-assistant-message"]',
          countBefore: messagesBefore,
        },
        { timeout: RESPONSE_TIMEOUT },
      );
    } catch {
      console.log(
        `  [WARN] ${label}: No assistant message within ${RESPONSE_TIMEOUT / 1000}s, using fallback wait`,
      );
      await page.waitForTimeout(5_000);
    }

    // Run demo-specific post-response interaction (e.g., click Approve for HITL)
    if (config.postResponse) {
      console.log(`  Running post-response interaction for ${label} ...`);
      await config.postResponse(page);
    }

    // Wait for visual effects to settle
    await page.waitForTimeout(config.extraWait ?? POST_RESPONSE_WAIT);

    // Close context to save the video
    await context.close();
    context = null;

    // Find the video file
    const videoFiles = fs
      .readdirSync(videoSubDir)
      .filter((f) => f.endsWith(".webm"))
      .map((f) => ({
        name: f,
        fullPath: path.join(videoSubDir, f),
        mtime: fs.statSync(path.join(videoSubDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (videoFiles.length === 0) {
      return {
        integrationSlug: target.integrationSlug,
        demoId: target.demoId,
        success: false,
        error: "No video file produced",
      };
    }

    const videoPath = videoFiles[0].fullPath;

    // Convert to GIF
    const gifDir = path.join(PREVIEWS_DIR, target.integrationSlug);
    fs.mkdirSync(gifDir, { recursive: true });
    const gifPath = path.join(gifDir, `${target.demoId}.gif`);

    const gifOk = convertToGif(videoPath, gifPath, label);

    // Clean up video subdir
    try {
      fs.rmSync(videoSubDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    if (!gifOk) {
      return {
        integrationSlug: target.integrationSlug,
        demoId: target.demoId,
        success: false,
        error: "ffmpeg conversion failed",
      };
    }

    const stat = fs.statSync(gifPath);
    console.log(
      `  [OK] ${label} -> ${gifPath} (${(stat.size / 1024).toFixed(0)} KB)`,
    );

    return {
      integrationSlug: target.integrationSlug,
      demoId: target.demoId,
      success: true,
      gifPath: `${target.integrationSlug}/${target.demoId}.gif`,
      gifSize: stat.size,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [FAIL] ${label}: ${msg}`);
    if (context) {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
    }
    // Clean up video subdir
    try {
      fs.rmSync(videoSubDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return {
      integrationSlug: target.integrationSlug,
      demoId: target.demoId,
      success: false,
      error: msg,
    };
  }
}

function convertToGif(
  videoPath: string,
  gifPath: string,
  label: string,
): boolean {
  console.log(`  Converting ${label} to GIF ...`);

  try {
    execSync("which ffmpeg", { stdio: "pipe" });
  } catch {
    console.log("  [ERROR] ffmpeg not found in PATH — skipping GIF conversion");
    return false;
  }

  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vf "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${gifPath}"`,
      { stdio: "pipe", timeout: 120_000 },
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [FAIL] ffmpeg conversion for ${label}: ${msg}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parallel execution with concurrency limit
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++;
      await fn(items[current]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { slug, demo, concurrency } = parseArgs();

  console.log("=== Showcase Demo Preview Capture ===");
  console.log(`Concurrency: ${concurrency}`);
  if (slug) console.log(`Filter by slug: ${slug}`);
  if (demo) console.log(`Filter by demo: ${demo}`);

  // Read all manifests
  console.log(`\nReading manifests from ${PACKAGES_DIR} ...`);
  const manifests = readAllManifests();
  console.log(`Found ${manifests.length} manifest(s)`);

  // Build targets
  const targets = buildTargets(manifests, slug, demo);
  console.log(`Capture targets: ${targets.length} demo(s)`);

  if (targets.length === 0) {
    console.log("Nothing to capture. Exiting.");
    return;
  }

  // Ensure output directories exist
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  fs.mkdirSync(PREVIEWS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results: CaptureResult[] = [];

  await runWithConcurrency(targets, concurrency, async (target) => {
    const result = await captureDemo(browser, target);
    results.push(result);
  });

  await browser.close();

  // Write manifest.json
  const manifestJson: Record<string, Record<string, string>> = {};
  for (const r of results) {
    if (r.success && r.gifPath) {
      if (!manifestJson[r.integrationSlug]) {
        manifestJson[r.integrationSlug] = {};
      }
      manifestJson[r.integrationSlug][r.demoId] = r.gifPath;
    }
  }

  const manifestJsonPath = path.join(PREVIEWS_DIR, "manifest.json");
  fs.writeFileSync(
    manifestJsonPath,
    JSON.stringify(manifestJson, null, 2) + "\n",
  );
  console.log(`\nWrote ${manifestJsonPath}`);

  // Clean up video directory
  try {
    fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Summary
  console.log("\n\n=== CAPTURE SUMMARY ===");
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalSize = succeeded.reduce((sum, r) => sum + (r.gifSize ?? 0), 0);

  console.log(`Succeeded: ${succeeded.length}/${results.length}`);
  for (const r of succeeded) {
    const sizeKB = r.gifSize ? `${(r.gifSize / 1024).toFixed(0)} KB` : "?";
    console.log(`  [OK] ${r.integrationSlug}/${r.demoId} (${sizeKB})`);
  }

  if (failed.length > 0) {
    console.log(`\nFailed: ${failed.length}/${results.length}`);
    for (const r of failed) {
      console.log(`  [FAIL] ${r.integrationSlug}/${r.demoId}: ${r.error}`);
    }
  }

  console.log(`\nTotal GIF size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
