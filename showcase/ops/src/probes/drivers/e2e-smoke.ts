import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { truncateUtf8 } from "../../render/filters.js";
import {
  resolveShape,
  showcaseShapeSchema,
} from "../discovery/railway-services.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * e2e-smoke driver — L3 (chat round-trip) and L4 (tool rendering) coverage
 * against each discovered showcase service. The driver launches a single
 * Chromium instance per invocation, navigates the deployed frontend at
 * `<backendUrl>/demos/<demo>`, sends a chat message, and asserts on the
 * response content.
 *
 * Three ProbeResults flow out of one invocation:
 *   - `e2e-smoke:<slug>` (aggregate, returned): green iff every level that
 *     ran passed; red otherwise. This is what the invoker's
 *     `writer.write()` picks up as the primary tick.
 *   - `chat:<slug>` (L3, side-emitted via ctx.writer): reflects the L3
 *     round-trip result in isolation so dashboards can distinguish "chat
 *     alone is broken" from "tool rendering is broken".
 *   - `tools:<slug>` (L4, side-emitted) — only when `demos.includes("tool-rendering")`.
 *     Absent for services that don't expose the tool-rendering demo.
 *
 * In-process vs spawn: the orchestrator already runs as a long-lived Node
 * process with `playwright` installed (see Dockerfile). Launching chromium
 * directly via `playwright.chromium.launch()` gives us first-class
 * AbortSignal propagation into `page.close()` / `browser.close()` rather
 * than having to kill a child process.
 *
 * Pluggable launcher: the production default imports `playwright` lazily
 * so the driver module loads cleanly in environments without chromium
 * (unit-test runs). Tests inject a fake launcher that produces a fake
 * Page, exercising the driver's adapter logic without touching a real
 * browser.
 */

const inputSchema = z
  .object({
    key: z.string().min(1),
    // `publicUrl` is the field the railway-services discovery source
    // populates with `https://<domain>` for each service. A static
    // `backendUrl` can be used as an alias so hand-wired YAML targets
    // don't have to match discovery's naming. The driver prefers
    // `backendUrl` when both are present.
    backendUrl: z.string().url().optional(),
    publicUrl: z.string().url().optional(),
    // Service name from Railway (e.g. "showcase-langgraph-python"). Used
    // to derive the slug for registry lookup when `demos` isn't supplied
    // in-band. Optional so static YAML targets can skip it.
    name: z.string().optional(),
    // Pre-resolved demos array — skips the registry lookup. Primarily
    // used by tests and by static-target YAML. Discovery-fed invocations
    // usually leave this undefined and let the driver resolve via the
    // registry.
    demos: z.array(z.string()).optional(),
    /**
     * Deployment shape tag from the discovery source. Starters are
     * single-app integrations with NO `/demos/*` routing, so L3/L4 is
     * skipped entirely on `shape === "starter"` — they would otherwise
     * produce one false-red `chat:<slug>` and one false-red
     * `tools:<slug>` row per starter per tick. Package shape keeps the
     * Playwright-against-/demos/* behaviour.
     *
     * Optional in the schema so static-YAML callers can pre-pin shape
     * explicitly; when absent in discovery-mode input the driver
     * reclassifies from `input.name` at run() entry. Explicit values
     * that disagree with the classifier cause run() to throw.
     */
    shape: showcaseShapeSchema.optional(),
  })
  .passthrough()
  .refine((v) => !!(v.backendUrl ?? v.publicUrl), {
    message: "backendUrl or publicUrl is required",
    path: ["backendUrl"],
  });

type E2eSmokeDriverInput = z.infer<typeof inputSchema>;

/**
 * Aggregate signal shape for the primary `e2e-smoke:<slug>` result.
 * Discriminated on `shape` so downstream consumers can exhaustively
 * switch without guessing which field combinations mean what.
 *
 *   - `shape: "starter"` — the driver short-circuited before launching
 *     chromium; `l3` and `l4` are both literally `"skipped"` and a
 *     `note` field carries the human-readable reason. Rows are always
 *     `state: "green"` for this variant, so the signal MUST NOT carry
 *     an `errorDesc` — alert templates render `errorDesc` as the
 *     failure reason and surfacing one on a green row would flap red
 *     in downstream views.
 *
 *   - `shape: "package"` — the driver ran Playwright against
 *     `/demos/*`. `l3` is `green` or `red`; `l4` can also be `skipped`
 *     when the registry entry has no `tool-rendering` demo. A red row
 *     may carry an `errorDesc` keyed to the failure class
 *     (`launcher-error`, `timeout`, `driver-error`, or absent when the
 *     failure lives in `failureSummary`).
 */
export type E2eSmokeSignal = E2eSmokeStarterSignal | E2eSmokePackageSignal;

export interface E2eSmokeStarterSignal {
  shape: "starter";
  slug: string;
  backendUrl: string;
  l3: "skipped";
  l4: "skipped";
  failureSummary: "";
  /**
   * Enum literal pinning the structural reason the level was skipped.
   * Separate from `note` so downstream consumers can branch on a stable
   * discriminator instead of parsing prose. Extend when a new skip
   * reason lands.
   */
  skipReason: "starter-shape";
  /** Human-readable explanation of WHY the level was skipped. Never rendered as a failure reason. */
  note: string;
  /**
   * Starter rows MUST NOT carry a failure reason — alert templates
   * render `errorDesc` as the red-tick summary and surfacing one on a
   * skipped-green row would flap red in downstream views. `?: never`
   * turns that invariant into a compile error, so a future path that
   * sets errorDesc on a starter fails tsc rather than slipping into
   * prod silently.
   */
  errorDesc?: never;
}

export interface E2eSmokePackageSignal {
  shape: "package";
  slug: string;
  backendUrl: string;
  /**
   * Per-level outcome.
   *   - "green" / "red"  standard probe result
   *   - "skipped"        L4 only — set when the registry entry has no
   *                      `tool-rendering` demo.
   */
  l3: "green" | "red";
  l4: "green" | "red" | "skipped";
  failureSummary: string;
  errorDesc?: string;
}

/** Per-level side-emit signal — one shape for both `chat:<slug>` and `tools:<slug>`. */
export interface E2eSmokeLevelSignal {
  slug: string;
  backendUrl: string;
  level: "chat" | "tools";
  responseText?: string;
  failureSummary: string;
  errorDesc?: string;
}

/**
 * Minimal Page surface the driver relies on. Captured here rather than
 * imported from `playwright` so unit tests can hand in a stub without
 * pulling the full runtime type tree (which carries ESM/CJS conditionals
 * that trip vitest's module loader on certain Node versions).
 */
export interface E2ePage {
  goto(
    url: string,
    opts?: { waitUntil?: "networkidle"; timeout?: number },
  ): Promise<unknown>;
  type(
    selector: string,
    text: string,
    opts?: { timeout?: number },
  ): Promise<void>;
  press(
    selector: string,
    key: string,
    opts?: { timeout?: number },
  ): Promise<void>;
  waitForSelector(
    selector: string,
    opts?: { timeout?: number; state?: "visible" },
  ): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
  /**
   * Run a function in the browser page context. Used for DOM reads that
   * must NOT auto-wait (Playwright's `page.textContent(selector)` waits
   * up to 30 s for the selector to match; `evaluate` returns immediately
   * with whatever the DOM currently holds).
   */
  evaluate<R>(fn: () => R): Promise<R>;
  close(): Promise<void>;
}

export interface E2eBrowserContext {
  newPage(): Promise<E2ePage>;
  close(): Promise<void>;
}

export interface E2eBrowser {
  newContext(): Promise<E2eBrowserContext>;
  close(): Promise<void>;
}

/**
 * Launcher injection seam. Production uses `defaultLauncher` which
 * dynamically imports `playwright` and calls `chromium.launch()`; tests
 * substitute a fake that returns a scripted E2eBrowser.
 */
export type E2eBrowserLauncher = () => Promise<E2eBrowser>;

/**
 * Resolver that maps a Railway service slug to its `demos` array, used
 * when the input didn't carry `demos` directly (discovery-fed case).
 * Production reads `/app/data/registry.json`, tests inject a pure fn.
 * Returns `[]` when the slug is unknown — unknown slug equals "no L4"
 * rather than an error because discovery can produce services that
 * haven't landed in the registry yet (new showcase being rolled out).
 */
export type DemosResolver = (slug: string) => Promise<string[]>;

export interface E2eSmokeDriverDeps {
  /** Browser launcher. Defaults to the real chromium launcher. */
  launcher?: E2eBrowserLauncher;
  /** Per-page navigation / wait timeout (ms). Defaults to 60s. */
  pageTimeoutMs?: number;
  /** Overall driver timeout (ms). Defaults to 3 minutes — matches YAML. */
  timeoutMs?: number;
  /** Resolver for demos-by-slug. Defaults to reading /app/data/registry.json. */
  demosResolver?: DemosResolver;
  /**
   * After `waitForSelector` succeeds, poll `textContent` until non-empty
   * for up to this many ms. CopilotKit renders the assistant-message
   * container before tokens stream in (`""` initially); slower
   * integrations (ms-agent-dotnet: extra network hop) need time for the
   * first token to arrive. Defaults to `pageTimeoutMs`.
   */
  textPollTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_PAGE_TIMEOUT_MS = 60 * 1000;

/**
 * Weather vocabulary the L4 response must include — mirrors the
 * `hasWeatherContent` check in showcase/tests/e2e/integration-smoke.spec.ts.
 * Keeping the list in one place so future vocabulary additions land in
 * exactly one spot; the unit test exercises the exact items below.
 */
const WEATHER_VOCAB = [
  "san francisco",
  "weather",
  "temperature",
  "degrees",
  "sunny",
  "cloudy",
  "rain",
  "humidity",
  "wind",
];

/**
 * Default launcher — dynamic import of `playwright` keeps the driver
 * module loadable in environments without chromium installed. Throws
 * an instructive error if the dependency tree is misconfigured; the
 * driver's outer try/catch surfaces the throw as a red ProbeResult with
 * `errorDesc: "launcher-error"` so operators see a specific, keyed
 * alert on the next tick.
 */
const defaultLauncher: E2eBrowserLauncher = async (): Promise<E2eBrowser> => {
  // Using a function-level dynamic import so unit tests that never invoke
  // the default launcher never touch the `playwright` package at all.
  const mod = (await import("playwright")) as typeof import("playwright");
  const browser = await mod.chromium.launch({
    headless: true,
    // Railway's container networking drops the default `--disable-dev-shm-usage`
    // assumption; passing it explicitly avoids /dev/shm exhaustion on tiny
    // replicas. Matches the GH-Actions smoke runner args.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  // Adapt the concrete Playwright API surface onto our minimal interface
  // so tests can swap in fakes without importing playwright's types.
  return {
    async newContext(): Promise<E2eBrowserContext> {
      const ctx = await browser.newContext();
      return {
        async newPage(): Promise<E2ePage> {
          const page = await ctx.newPage();
          return {
            goto: (url, opts) => page.goto(url, opts),
            type: (sel, text, opts) => page.type(sel, text, opts),
            press: (sel, key, opts) => page.press(sel, key, opts),
            waitForSelector: (sel, opts) => page.waitForSelector(sel, opts),
            textContent: (sel) => page.textContent(sel),
            evaluate: <R>(fn: () => R) => page.evaluate(fn),
            close: () => page.close(),
          };
        },
        close: () => ctx.close(),
      };
    },
    close: () => browser.close(),
  };
};

/**
 * Default demos resolver. Reads `/app/data/registry.json` once (memoised
 * in-closure) and looks up `integrations[].slug → demos[].id`. The
 * Dockerfile copies `showcase/shell/src/data/registry.json` into that
 * path; local dev can override via `REGISTRY_JSON_PATH` env. Returns `[]`
 * on missing file / parse error — a misconfigured runtime image should
 * degrade to "L3 only" rather than failing every tick outright.
 */
function createDefaultDemosResolver(): DemosResolver {
  let cache: Map<string, string[]> | null = null;
  return async (slug: string): Promise<string[]> => {
    if (cache === null) {
      const override = process.env.REGISTRY_JSON_PATH;
      const fallback = path.resolve("/app/data/registry.json");
      const registryPath = override ?? fallback;
      try {
        const raw = await fs.readFile(registryPath, "utf-8");
        const parsed = JSON.parse(raw) as {
          integrations?: Array<{
            slug?: string;
            demos?: Array<{ id?: string }>;
          }>;
        };
        const map = new Map<string, string[]>();
        for (const it of parsed.integrations ?? []) {
          if (!it.slug) continue;
          const demoIds = (it.demos ?? [])
            .map((d) => d.id)
            .filter((id): id is string => typeof id === "string");
          map.set(it.slug, demoIds);
        }
        cache = map;
      } catch {
        cache = new Map();
      }
    }
    return cache.get(slug) ?? [];
  };
}

/** Create a configured e2e-smoke driver. Exported for tests; production
 * callers use the module-level `e2eSmokeDriver`. */
export function createE2eSmokeDriver(
  deps: E2eSmokeDriverDeps = {},
): ProbeDriver<E2eSmokeDriverInput, E2eSmokeSignal> {
  const launcher = deps.launcher ?? defaultLauncher;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pageTimeoutMs = deps.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const textPollTimeoutMs = deps.textPollTimeoutMs ?? pageTimeoutMs;
  const demosResolver = deps.demosResolver ?? createDefaultDemosResolver();

  return {
    kind: "e2e_smoke",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: E2eSmokeDriverInput,
    ): Promise<ProbeResult<E2eSmokeSignal>> {
      const observedAt = ctx.now().toISOString();
      // Prefer explicit backendUrl; fall back to discovery-supplied publicUrl.
      // Schema already guaranteed at least one is present.
      const backendUrl = (input.backendUrl ?? input.publicUrl)!;
      const slug = deriveSlug(input.key, input.name);
      const shape = resolveShape(
        { name: input.name, shape: input.shape },
        { logger: ctx.logger },
      );

      // Starter short-circuit — runs BEFORE chromium launch AND BEFORE
      // demos resolution so a broken registry / missing chromium image
      // never contributes a false-red row for a starter. The ordering
      // here is load-bearing; the test suite locks it in.
      if (shape === "starter") {
        return {
          key: input.key,
          state: "green",
          signal: {
            shape: "starter",
            slug,
            backendUrl,
            l3: "skipped",
            l4: "skipped",
            failureSummary: "",
            skipReason: "starter-shape",
            note: "starter: no /demos/* routing",
          },
          observedAt,
        };
      }

      // Demos resolution: (1) in-band `input.demos`, (2) registry lookup
      // via the injected resolver. A slug with no demos entry gets
      // `[]` which skips L4 — the same outcome as a service that
      // legitimately doesn't expose tool-rendering.
      let demos: string[];
      if (Array.isArray(input.demos)) {
        demos = input.demos;
      } else {
        try {
          demos = await demosResolver(slug);
        } catch (err) {
          ctx.logger.warn("probe.e2e-smoke.demos-resolve-failed", {
            slug,
            err: err instanceof Error ? err.message : String(err),
          });
          demos = [];
        }
      }
      const hasToolRendering = demos.includes("tool-rendering");

      // Arm an AbortController that combines:
      //   1. The driver's own `timeoutMs` hard cap (triggers teardown).
      //   2. The invoker-provided `ctx.abortSignal` (so a probe-level
      //      timeout in probe-invoker.ts also propagates into page.close()
      //      / browser.close()).
      const abort = new AbortController();
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, timeoutMs);
      const externalAbort = ctx.abortSignal;
      const onExternalAbort = (): void => {
        abort.abort();
      };
      if (externalAbort) {
        if (externalAbort.aborted) {
          abort.abort();
        } else {
          externalAbort.addEventListener("abort", onExternalAbort, {
            once: true,
          });
        }
      }

      let browser: E2eBrowser | undefined;
      const tearDown = async (): Promise<void> => {
        if (browser) {
          try {
            await browser.close();
          } catch (err) {
            ctx.logger.warn("probe.e2e-smoke.browser-close-failed", {
              slug,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      };

      try {
        try {
          browser = await launcher();
        } catch (err) {
          // If the driver's hard-timeout fired first and aborted a
          // launcher that observes the signal, surface the timeout path
          // rather than masquerading the abort as a launcher-error. The
          // user-facing distinction matters: launcher-error → chromium
          // missing; timeout → remote stack slow.
          if (timedOut) {
            throw err;
          }
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn("probe.e2e-smoke.launcher-error", { slug, err: msg });
          return {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              l3: "red",
              l4: hasToolRendering ? "red" : "skipped",
              failureSummary: truncateUtf8(msg, 1200),
              errorDesc: "launcher-error",
            },
            observedAt,
          };
        }

        // L3 — chat round-trip against /demos/agentic-chat.
        const l3 = await runLevel({
          browser,
          slug,
          backendUrl,
          level: "chat",
          demoPath: "/demos/agentic-chat",
          message: "Hello, please respond with a brief greeting.",
          abortSignal: abort.signal,
          pageTimeoutMs,
          textPollTimeoutMs,
          now: ctx.now,
          assertResponse: (text) => ({
            ok: text.length > 0,
            summary: text.length === 0 ? "empty assistant response" : "",
          }),
        });
        if (ctx.writer) {
          try {
            await ctx.writer.write({
              key: `chat:${slug}`,
              state: l3.result.state,
              signal: l3.result.signal,
              observedAt: ctx.now().toISOString(),
            });
          } catch (err) {
            ctx.logger.error("probe.e2e-smoke.chat-writer-failed", {
              slug,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }

        let l4State: "green" | "red" | "skipped" = "skipped";
        let l4Summary = "";
        if (hasToolRendering) {
          const l4 = await runLevel({
            browser,
            slug,
            backendUrl,
            level: "tools",
            demoPath: "/demos/tool-rendering",
            message: "What's the weather in San Francisco?",
            abortSignal: abort.signal,
            pageTimeoutMs,
            textPollTimeoutMs,
            now: ctx.now,
            assertResponse: (text) => {
              if (text.length === 0) {
                return { ok: false, summary: "empty assistant response" };
              }
              const lc = text.toLowerCase();
              const hit = WEATHER_VOCAB.some((v) => lc.includes(v));
              return {
                ok: hit,
                summary: hit
                  ? ""
                  : `response missing weather vocabulary: ${truncateUtf8(text, 200)}`,
              };
            },
          });
          l4State = l4.result.state === "green" ? "green" : "red";
          l4Summary = l4.result.signal.failureSummary;
          if (ctx.writer) {
            try {
              await ctx.writer.write({
                key: `tools:${slug}`,
                state: l4.result.state,
                signal: l4.result.signal,
                observedAt: ctx.now().toISOString(),
              });
            } catch (err) {
              ctx.logger.error("probe.e2e-smoke.tools-writer-failed", {
                slug,
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        const l3State: "green" | "red" =
          l3.result.state === "green" ? "green" : "red";
        const aggregateGreen = l3State === "green" && l4State !== "red";
        const failureSummary = aggregateGreen
          ? ""
          : truncateUtf8(
              [
                l3State === "red"
                  ? `L3: ${l3.result.signal.failureSummary}`
                  : "",
                l4State === "red" ? `L4: ${l4Summary}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              1200,
            );

        return {
          key: input.key,
          state: aggregateGreen ? "green" : "red",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            l3: l3State,
            l4: l4State,
            failureSummary,
          },
          observedAt,
        };
      } catch (err) {
        if (timedOut) {
          ctx.logger.warn("probe.e2e-smoke.timeout", { slug, timeoutMs });
          return {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              l3: "red",
              l4: hasToolRendering ? "red" : "skipped",
              failureSummary: `timeout after ${timeoutMs}ms`,
              errorDesc: "timeout",
            },
            observedAt,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.e2e-smoke.driver-error", { slug, err: msg });
        return {
          key: input.key,
          state: "red",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            l3: "red",
            l4: hasToolRendering ? "red" : "skipped",
            failureSummary: truncateUtf8(msg, 1200),
            errorDesc: "driver-error",
          },
          observedAt,
        };
      } finally {
        clearTimeout(timeoutHandle);
        if (externalAbort) {
          externalAbort.removeEventListener("abort", onExternalAbort);
        }
        await tearDown();
      }
    },
  };
}

/**
 * Run one level (L3 or L4): open a fresh browser context + page, navigate,
 * send the message, read the assistant response, and apply the caller's
 * assertion. Each level owns its own context so cookies/localStorage from
 * L3 don't contaminate L4 (and vice versa). Context is always closed in
 * the finally block, even on assertion failure, so a hung L3 doesn't
 * orphan a context that would block the L4 run.
 */
async function runLevel(opts: {
  browser: E2eBrowser;
  slug: string;
  backendUrl: string;
  level: "chat" | "tools";
  demoPath: string;
  message: string;
  abortSignal: AbortSignal;
  pageTimeoutMs: number;
  textPollTimeoutMs: number;
  now: () => Date;
  assertResponse: (text: string) => { ok: boolean; summary: string };
}): Promise<{ result: ProbeResult<E2eSmokeLevelSignal> }> {
  const {
    browser,
    slug,
    backendUrl,
    level,
    demoPath,
    message,
    abortSignal,
    pageTimeoutMs,
    textPollTimeoutMs,
    now,
    assertResponse,
  } = opts;

  if (abortSignal.aborted) {
    // Surface as red so the aggregate bookkeeping still reads "ran".
    return {
      result: {
        key: `${level}:${slug}`,
        state: "red",
        signal: {
          slug,
          backendUrl,
          level,
          failureSummary: "aborted before start",
          errorDesc: "abort",
        },
        observedAt: now().toISOString(),
      },
    };
  }

  let context: E2eBrowserContext | undefined;
  let page: E2ePage | undefined;
  try {
    context = await browser.newContext();
    page = await context.newPage();
    const url = `${backendUrl}${demoPath}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: pageTimeoutMs });

    // Wait for the chat textarea, type, and submit. Selector mirrors the
    // reference helper (showcase/tests/e2e/helpers.ts) — CopilotKit
    // renders a single <textarea> for the chat input.
    await page.waitForSelector("textarea", {
      state: "visible",
      timeout: pageTimeoutMs,
    });
    await page.type("textarea", message, { timeout: pageTimeoutMs });
    await page.press("textarea", "Enter", { timeout: pageTimeoutMs });

    // Wait for an assistant message to appear. The helper's testid
    // convention is `[data-testid="copilot-assistant-message"]`; some
    // showcases don't set the testid, so we fall back to scraping the
    // <body> for substantive text that appeared after our message.
    let responseText = "";
    try {
      await page.waitForSelector('[data-testid="copilot-assistant-message"]', {
        state: "visible",
        timeout: pageTimeoutMs,
      });
      // CopilotKit renders the assistant-message container before tokens
      // stream in (starts as ""). Slower integrations (ms-agent-dotnet:
      // extra network hop) need time for the first token to arrive. Poll
      // for non-empty textContent instead of reading once.
      //
      // IMPORTANT: we use `page.evaluate()` instead of
      // `page.textContent(selector)` for two reasons:
      //
      //   1. CSS `:last-of-type` is unreliable here. CopilotKit often
      //      renders a trailing <div> (streaming indicator, input area)
      //      after the assistant-message <div>. `:last-of-type` selects
      //      the last element of a given TAG TYPE among siblings, so it
      //      matches the trailing <div> — not the assistant message.
      //      The compound selector
      //      `[data-testid="copilot-assistant-message"]:last-of-type`
      //      then matches ZERO elements.
      //
      //   2. Playwright's `page.textContent(selector)` auto-waits up to
      //      30 s for the selector to match. When the selector matches
      //      nothing (see #1), each poll iteration blocks for 30 s and
      //      then throws — making the 500 ms poll interval meaningless.
      //      Two failed polls exhaust the entire textPollTimeoutMs
      //      budget, and the outer catch swallows the timeout, returning
      //      empty text → false-red.
      //
      // `page.evaluate()` runs synchronously in the browser context,
      // returns immediately with whatever the DOM currently holds, and
      // uses `querySelectorAll` to find the last matching element by
      // index rather than by CSS pseudo-selector.
      let raw = "";
      const pollEnd = Date.now() + textPollTimeoutMs;
      while (Date.now() < pollEnd) {
        // The callback executes in the browser where `document` exists.
        // TypeScript's Node-only `lib` doesn't include DOM types, so we
        // access `document` via `globalThis` to avoid a compile error
        // without polluting the project-wide tsconfig with `"dom"`.
        raw =
          (await page.evaluate(() => {
            // `document` lives in the browser context where this callback
            // runs. The server-side tsconfig intentionally excludes DOM
            // types, so we reach it via a type-erased indirection.
            const win = globalThis as unknown as {
              document: {
                querySelectorAll(
                  sel: string,
                ): ArrayLike<{ textContent: string | null }>;
              };
            };
            const msgs = win.document.querySelectorAll(
              '[data-testid="copilot-assistant-message"]',
            );
            if (msgs.length === 0) return "";
            return msgs[msgs.length - 1]!.textContent ?? "";
          })) ?? "";
        if (raw.trim().length > 0) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      responseText = raw.trim();
    } catch {
      // Fallback: pull <body> text and slice off everything up to and
      // including our sent message. Mirrors helpers.ts's fallback.
      const body = (await page.textContent("body")) ?? "";
      const idx = body.lastIndexOf(message);
      if (idx >= 0) {
        const tail = body
          .slice(idx + message.length)
          .replace(/Regenerate response/g, "")
          .replace(/Copy to clipboard/g, "")
          .replace(/Thumbs (up|down)/g, "")
          .replace(/Powered by CopilotKit/g, "")
          .replace(/Type a message\.\.\./g, "")
          .trim();
        if (tail.length > 20) {
          responseText = tail.split("\n")[0]!.trim();
        }
      }
    }

    const assertion = assertResponse(responseText);
    return {
      result: {
        key: `${level}:${slug}`,
        state: assertion.ok ? "green" : "red",
        signal: {
          slug,
          backendUrl,
          level,
          responseText: responseText || undefined,
          failureSummary: assertion.ok ? "" : assertion.summary,
        },
        observedAt: now().toISOString(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      result: {
        key: `${level}:${slug}`,
        state: "red",
        signal: {
          slug,
          backendUrl,
          level,
          failureSummary: truncateUtf8(msg, 1200),
          errorDesc: abortSignal.aborted ? "abort" : "level-error",
        },
        observedAt: now().toISOString(),
      },
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* swallow — context.close() still cleans up. */
      }
    }
    if (context) {
      try {
        await context.close();
      } catch {
        /* swallow — browser.close() in outer finally catches remnants. */
      }
    }
  }
}

/**
 * Extract the slug used for side-emit keys and registry lookup. Preference:
 *   1. Everything after `:` in `input.key` (matches the YAML dedupe key).
 *   2. Railway service `name` with the `showcase-` prefix stripped (the
 *      name-based form when the YAML key-template doesn't yet carry the
 *      slug cleanly).
 *   3. The whole key as-is (fallback).
 */
function deriveSlug(key: string, name?: string): string {
  const parts = key.split(":");
  let raw: string;
  if (parts.length >= 2 && parts[1]!.length > 0) {
    raw = parts.slice(1).join(":");
  } else if (name) {
    raw = name;
  } else {
    raw = key;
  }
  // Strip the `showcase-` prefix when present so the slug lines up with
  // registry.json's `integrations[].slug` keys (which are bare —
  // "langgraph-python", not "showcase-langgraph-python").
  return raw.startsWith("showcase-") ? raw.slice("showcase-".length) : raw;
}

/** Default driver instance with the real Playwright launcher. Registered
 * by the orchestrator at boot. */
export const e2eSmokeDriver = createE2eSmokeDriver();
