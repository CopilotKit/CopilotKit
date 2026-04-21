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
 * Requires: playwright (installed in showcase/scripts/), ffmpeg, yaml
 */

import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import { execSync, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseManifest } from "./lib/manifest.js";
import type { Manifest } from "./lib/manifest.js";

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
  "hitl-in-chat": {
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
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        console.log(
          `    [WARN] Could not detect todo list update for shared-state-write (${isTimeout ? "timeout" : err instanceof Error ? `${err.name}: ${err.message}` : String(err)})`,
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

const KNOWN_CAPTURE_FLAGS = ["--slug", "--demo", "--concurrency"] as const;

function parseArgs(): { slug?: string; demo?: string; concurrency: number } {
  const args = process.argv.slice(2);
  let slug: string | undefined;
  let demo: string | undefined;
  const DEFAULT_CONCURRENCY = 3;
  let concurrency: number | undefined;
  // Track whether each flag has been seen so a repeated occurrence
  // (`--slug a --slug b`) is rejected loudly instead of silently
  // overwriting the earlier value. Mirrors the strict parser in
  // create-integration/index.ts where duplicate flags are a hard error.
  let sawSlug = false;
  let sawDemo = false;
  let sawConcurrency = false;

  // Reject `--flag --other` confusion (where the value of --flag would
  // silently be captured as another flag token) and unknown flags
  // (typos like `--sulg`). Mirrors the stricter parser in
  // create-integration/index.ts so operator mistakes surface loudly
  // instead of silently no-op'ing the intended filter.
  const requireValue = (flag: string, value: string | undefined): string => {
    if (value === undefined) {
      throw new Error(`Missing value for ${flag} (end of args).`);
    }
    if (value.startsWith("--")) {
      throw new Error(
        `Missing value for ${flag} (got another flag: ${value}).`,
      );
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug") {
      if (sawSlug) {
        throw new Error(`--slug specified more than once.`);
      }
      sawSlug = true;
      slug = requireValue("--slug", args[i + 1]);
      i++;
    } else if (args[i] === "--demo") {
      if (sawDemo) {
        throw new Error(`--demo specified more than once.`);
      }
      sawDemo = true;
      demo = requireValue("--demo", args[i + 1]);
      i++;
    } else if (args[i] === "--concurrency") {
      if (sawConcurrency) {
        throw new Error(`--concurrency specified more than once.`);
      }
      sawConcurrency = true;
      // Validate the user-supplied value rather than silently coercing
      // `0` / `NaN` / negatives into the default. Masking bad input led
      // operators to assume `--concurrency 0` meant "sequential" when it
      // actually fell through to the default (3). Require a positive
      // integer and reject anything else loudly — the default only
      // applies when the flag is omitted entirely.
      //
      // Use strict digits-only pre-filtering (mirroring validate-parity's
      // `coerceBaseline`) rather than bare `Number(raw)` + `isInteger`,
      // because `Number("0x10")` returns 16 and `Number("3.0")` returns 3
      // — both would pass a naive isInteger check and silently accept
      // hex/float input the operator almost certainly did not mean.
      const raw = requireValue("--concurrency", args[i + 1]);
      i++;
      const trimmed = raw.trim();
      let reason: string | null = null;
      if (trimmed.length === 0) {
        reason = "empty / whitespace only";
      } else if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
        reason = "hex literal not accepted";
      } else if (/^-\d+$/.test(trimmed)) {
        reason = "must be positive (got a negative value)";
      } else if (/^-?\d+\.\d+$/.test(trimmed)) {
        reason = "must be an integer (got a float)";
      } else if (trimmed === "0" || /^0+$/.test(trimmed)) {
        reason = "must be >= 1 (got zero)";
      } else if (!/^[1-9]\d*$/.test(trimmed)) {
        reason = "not a base-10 positive integer";
      }
      if (reason !== null) {
        throw new Error(
          `--concurrency must be a positive integer (got "${raw}": ${reason})`,
        );
      }
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        // Belt-and-suspenders: the regex above should have already
        // rejected every non-positive-integer shape, but guard against
        // Number() returning something unexpected on exotic input.
        throw new Error(
          `--concurrency must be a positive integer (got "${raw}")`,
        );
      }
      concurrency = n;
    } else {
      throw new Error(
        `Unknown flag: ${args[i]}. Valid flags: ${KNOWN_CAPTURE_FLAGS.join(", ")}`,
      );
    }
  }

  return { slug, demo, concurrency: concurrency ?? DEFAULT_CONCURRENCY };
}

// ---------------------------------------------------------------------------
// Manifest reading
// ---------------------------------------------------------------------------

interface CaptureTarget {
  integrationSlug: string;
  integrationName: string;
  backendUrl: string;
  demoId: string;
  demoRoute: string;
}

function readAllManifests(): Manifest[] {
  const manifests: Manifest[] = [];
  // Readdir on the packages dir can fail with ENOENT (wrong cwd /
  // missing checkout), EACCES (permissions), or other I/O errors.
  // Surface a specific diagnostic and exit — otherwise the stack trace
  // from a bare throw buries the actionable bit (which path, which
  // errno) and operators waste time chasing it. Mirrors the pattern
  // used in validate-parity.ts readdirSync branches.
  let packageDirs: string[];
  try {
    packageDirs = fs
      .readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "ENOENT") {
      console.error(
        `[capture-previews] Packages directory not found at ${PACKAGES_DIR} (ENOENT). ` +
          "Run from the monorepo root or fix the path.",
      );
    } else if (code === "EACCES" || code === "EPERM") {
      console.error(
        `[capture-previews] Cannot read packages directory ${PACKAGES_DIR} (${code}): ${msg}. ` +
          "Check filesystem permissions.",
      );
    } else {
      console.error(
        `[capture-previews] Failed to list packages directory ${PACKAGES_DIR}: ${msg}`,
      );
    }
    process.exit(2);
  }

  // In CI mode, a YAML parse error is fatal (a corrupt manifest would
  // silently drop the integration from the preview matrix); locally we
  // warn-and-continue so an in-flight edit doesn't block iteration.
  const ciMode =
    process.env.CI === "true" || process.env.CAPTURE_PREVIEWS_STRICT === "true";

  for (const dir of packageDirs) {
    const manifestPath = path.join(PACKAGES_DIR, dir, "manifest.yaml");
    // Delegate shape + read + parse to the shared parseManifest. That
    // returns a tagged union distinguishing missing / malformed /
    // unreadable / ok, so CI can refuse to continue on real shape drift
    // while local runs warn-and-continue during iteration.
    const result = parseManifest(manifestPath, dir);
    if (result.kind === "missing") continue;
    if (result.kind === "ok") {
      manifests.push(result.manifest);
      continue;
    }
    // malformed (syntax or shape) or unreadable — surface differently
    // per ciMode. The malformed "shape" subkind is especially
    // important: a non-regular file or empty YAML body collapses into
    // a shape-malformed result via parseManifest, so the previous
    // "not a regular file; skipping" warning is now part of this branch.
    const detail =
      result.kind === "unreadable"
        ? result.error
        : `${result.subkind}: ${result.error}`;
    if (ciMode) {
      throw new Error(
        `Failed to load ${manifestPath} in CI mode: ${detail}. ` +
          "Refusing to continue with an incomplete preview manifest.",
      );
    }
    console.warn(`  [WARN] Failed to load ${manifestPath}: ${detail}`);
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
    // A deployed integration without a backend_url cannot be navigated
    // to. Skip with a warning rather than producing a broken target
    // (which would fail later during page.goto with a confusing error).
    if (!m.backend_url) {
      console.warn(
        `  [SKIP] ${m.slug} — deployed but no backend_url in manifest.yaml`,
      );
      continue;
    }

    for (const demo of m.demos) {
      if (filterDemo && demo.id !== filterDemo) {
        continue;
      }
      // demo.route is optional on the shared Manifest type. Fall back
      // to "/demos/<id>" when absent, matching the convention used by
      // generator + shell + the other consumers.
      const route = demo.route ?? `/demos/${demo.id}`;
      targets.push({
        integrationSlug: m.slug,
        integrationName: m.name ?? m.slug,
        backendUrl: m.backend_url,
        demoId: demo.id,
        demoRoute: route,
      });
    }
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Capture logic
// ---------------------------------------------------------------------------

// Tagged-union variants replace the previous boolean+optional-fields shape
// so the "succeeded" and "failed" branches have distinct, exhaustive types.
// Callers that previously consulted `result.success` now switch on `kind`
// and get compile-time guarantees about which fields are defined.
interface CaptureSuccess {
  kind: "success";
  integrationSlug: string;
  demoId: string;
  gifPath: string;
  gifSize: number;
}

interface CaptureFailure {
  kind: "failure";
  integrationSlug: string;
  demoId: string;
  error: string;
}

type CaptureResult = CaptureSuccess | CaptureFailure;

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

    // Wait for a new assistant message. If none arrives within
    // RESPONSE_TIMEOUT, tag the capture as a response-timeout failure
    // and tear down cleanly — falling through would mask the real
    // failure behind a GIF that captured only the empty prompt.
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `  [WARN] ${label}: No assistant message within ${RESPONSE_TIMEOUT / 1000}s (${msg}); aborting capture`,
      );
      // Close the context so recording teardown happens on the same
      // failure path as the other error branches.
      if (context) {
        try {
          await context.close();
        } catch (closeErr) {
          console.warn(
            `[capture-previews] cleanup failed for context (${label}):`,
            closeErr,
          );
        }
        context = null;
      }
      try {
        fs.rmSync(videoSubDir, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn(
          `[capture-previews] cleanup failed for video subdir ${videoSubDir}:`,
          rmErr,
        );
      }
      return {
        kind: "failure",
        integrationSlug: target.integrationSlug,
        demoId: target.demoId,
        error: "response-timeout",
      };
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
        kind: "failure",
        integrationSlug: target.integrationSlug,
        demoId: target.demoId,
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
    } catch (err) {
      console.warn(
        `[capture-previews] cleanup failed for video subdir ${videoSubDir}:`,
        err,
      );
    }

    if (!gifOk) {
      return {
        kind: "failure",
        integrationSlug: target.integrationSlug,
        demoId: target.demoId,
        error: "ffmpeg conversion failed",
      };
    }

    const stat = fs.statSync(gifPath);
    console.log(
      `  [OK] ${label} -> ${gifPath} (${(stat.size / 1024).toFixed(0)} KB)`,
    );

    return {
      kind: "success",
      integrationSlug: target.integrationSlug,
      demoId: target.demoId,
      gifPath: `${target.integrationSlug}/${target.demoId}.gif`,
      gifSize: stat.size,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [FAIL] ${label}: ${msg}`);
    if (context) {
      try {
        await context.close();
      } catch (closeErr) {
        console.warn(
          `[capture-previews] cleanup failed for context (${label}):`,
          closeErr,
        );
      }
    }
    // Clean up video subdir
    try {
      fs.rmSync(videoSubDir, { recursive: true, force: true });
    } catch (rmErr) {
      console.warn(
        `[capture-previews] cleanup failed for video subdir ${videoSubDir}:`,
        rmErr,
      );
    }
    return {
      kind: "failure",
      integrationSlug: target.integrationSlug,
      demoId: target.demoId,
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
    // Use execFileSync (not execSync) so the videoPath and gifPath are
    // passed as argv entries and never interpreted by a shell. Slugs or
    // demo ids containing shell metacharacters (`"`, `$()`, etc.) cannot
    // break out of template-literal quoting and inject commands.
    const vfFilter = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    execFileSync(
      "ffmpeg",
      ["-y", "-i", videoPath, "-vf", vfFilter, "-loop", "0", gifPath],
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
    // If the user supplied a --slug or --demo filter, an empty result
    // almost certainly means they fat-fingered the value (or the
    // matching package isn't deployed). Exit non-zero so CI / shell
    // pipelines surface the miss instead of reporting success for a
    // no-op run. Without a filter, an empty set is the "nothing
    // deployed yet" steady state and still exits 0.
    if (slug || demo) {
      console.error(
        `Nothing to capture. Filter did not match any deployed demos: ` +
          `${slug ? `slug="${slug}" ` : ""}${demo ? `demo="${demo}"` : ""}`.trim(),
      );
      process.exit(1);
    }
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
    if (r.kind === "success") {
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
  } catch (err) {
    console.warn(
      `[capture-previews] cleanup failed for video directory ${VIDEO_DIR}:`,
      err,
    );
  }

  // Summary
  console.log("\n\n=== CAPTURE SUMMARY ===");
  const succeeded = results.filter(
    (r): r is CaptureSuccess => r.kind === "success",
  );
  const failed = results.filter(
    (r): r is CaptureFailure => r.kind === "failure",
  );
  const totalSize = succeeded.reduce((sum, r) => sum + r.gifSize, 0);

  console.log(`Succeeded: ${succeeded.length}/${results.length}`);
  for (const r of succeeded) {
    const sizeKB = `${(r.gifSize / 1024).toFixed(0)} KB`;
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
