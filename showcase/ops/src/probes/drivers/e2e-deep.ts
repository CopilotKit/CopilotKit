import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { truncateUtf8 } from "../../render/filters.js";
import { showcaseShapeSchema } from "../discovery/railway-services.js";
import {
  D5_REGISTRY,
  type D5BuildContext,
  type D5FeatureType,
  type D5Script,
} from "../helpers/d5-registry.js";
import {
  runConversation,
  type ConversationResult,
  type Page,
} from "../helpers/conversation-runner.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * D5 — e2e-deep (multi-turn conversation) driver.
 *
 * One driver invocation handles one Railway showcase service. For every
 * D5 feature type the integration declares, the driver:
 *   1. Looks up the script in `D5_REGISTRY` (populated by the dynamic
 *      loader scanning `src/probes/scripts/d5-*.{js,ts}` at boot).
 *   2. Skips with a green `note: "no script registered"` row when the
 *      registry has no script for that featureType — Wave 2b ships
 *      scripts in parallel and the driver must run cleanly while the
 *      registry is still partially populated.
 *   3. Opens a fresh Playwright context, navigates to the per-feature
 *      route (`/demos/<featureType>` by default; script may override
 *      via `preNavigateRoute`), and runs the conversation through
 *      `runConversation` from `helpers/conversation-runner.ts`.
 *   4. Emits one `d5:<slug>/<featureType>` side row per feature, plus
 *      an aggregate `e2e-deep:<slug>` primary result.
 *
 * State mapping (per spec):
 *   - green  — every turn completed and no assertion failure (i.e.
 *              `failure_turn` is absent).
 *   - red    — `failure_turn` is set OR the navigation/launch failed.
 *   - amber  — reserved for future fuzzy outcomes (not emitted today).
 *
 * Side-row key shape `d5:<slug>/<featureType>` mirrors the existing
 * `e2e:<slug>/<featureId>` pattern from the e2e-demos driver so the
 * dashboard's per-cell lookup pattern stays uniform across drivers.
 *
 * Pluggable launcher + script loader: production defaults dynamically
 * import `playwright` and scan `scripts/`. Tests inject fakes for both
 * — no real browser, no filesystem scan, deterministic registry state.
 */

const inputSchema = z
  .object({
    key: z.string().min(1),
    backendUrl: z.string().url().optional(),
    publicUrl: z.string().url().optional(),
    name: z.string().optional(),
    /**
     * The list of D5 feature types the integration declares. Driver
     * fans out over this list. Empty / absent → aggregate-green
     * short-circuit, no chromium launched.
     */
    features: z.array(z.string()).optional(),
    shape: showcaseShapeSchema.optional(),
  })
  .passthrough()
  .refine((v) => !!(v.backendUrl ?? v.publicUrl), {
    message: "backendUrl or publicUrl is required",
    path: ["backendUrl"],
  });

type E2eDeepDriverInput = z.infer<typeof inputSchema>;

/**
 * Aggregate signal carried on the primary `e2e-deep:<slug>` row.
 *
 *   - `shape: "starter"`  — short-circuit before launch. Starters have
 *                           no demo routing.
 *   - `shape: "package"`  — normal fan-out. `failed`/`skipped` track
 *                           per-feature outcomes.
 */
export interface E2eDeepAggregateSignal {
  shape: "package" | "starter";
  slug: string;
  backendUrl: string;
  total: number;
  passed: number;
  failed: string[];
  /**
   * Feature types that had no registered script in `D5_REGISTRY` at
   * tick time. Carried separately from `failed` because a missing
   * script is a coverage gap (Wave 2b not done yet), not a regression.
   */
  skipped: string[];
  note?: string;
  /**
   * Present only on aggregate-level failures that prevented per-feature
   * checks from running (e.g. `"launcher-error"` when chromium failed
   * to launch). Keyed vocabulary so alert rules can branch on a stable
   * discriminator.
   */
  errorDesc?: string;
  /** Free-form failure detail for aggregate-level failures. */
  failureSummary?: string;
}

/** Per-feature side-emit signal carried on each `d5:<slug>/<featureType>` row. */
export interface E2eDeepFeatureSignal {
  slug: string;
  featureType: string;
  backendUrl: string;
  url?: string;
  fixtureFile?: string;
  turns_completed?: number;
  total_turns?: number;
  failure_turn?: number;
  /**
   * Per-turn wall-clock duration. Length equals `turns_completed`
   * (failed turns are not in the array — see conversation-runner.ts
   * spec). Absent on rows that short-circuited before running any
   * turn (skipped, launcher-error, etc.).
   */
  turn_durations_ms?: number[];
  errorDesc?: string;
  errorClass?: string;
  note?: string;
}

/**
 * Minimal page surface the driver depends on. Combines the
 * conversation-runner's `Page` (selector / fill / press / evaluate)
 * with the navigation + teardown calls the driver makes itself
 * (`goto`, `close`). Real `playwright.Page` satisfies this
 * structurally; tests inject scripted fakes.
 */
export interface E2eDeepPage extends Page {
  goto(
    url: string,
    opts?: {
      waitUntil?: "networkidle" | "domcontentloaded";
      timeout?: number;
    },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface E2eDeepBrowserContext {
  newPage(): Promise<E2eDeepPage>;
  close(): Promise<void>;
}

export interface E2eDeepBrowser {
  newContext(): Promise<E2eDeepBrowserContext>;
  close(): Promise<void>;
}

export type E2eDeepBrowserLauncher = () => Promise<E2eDeepBrowser>;

/**
 * Script loader — invoked once per driver invocation (the registry is
 * idempotent; double-registration throws so a second load won't
 * silently re-register). Production default scans
 * `src/probes/scripts/d5-*.{js,ts}` relative to the compiled driver's
 * own directory and imports each file. Tests inject a no-op loader.
 */
export type E2eDeepScriptLoader = (ctx: ProbeContext) => Promise<void>;

export interface E2eDeepDriverDeps {
  launcher?: E2eDeepBrowserLauncher;
  pageTimeoutMs?: number;
  timeoutMs?: number;
  scriptLoader?: E2eDeepScriptLoader;
  /**
   * Override the navigation URL builder. Defaults to
   * `${baseUrl}${preNavigateRoute(ft) ?? "/demos/<ft>"}`. Tests use
   * this to assert the URL composition without booting chromium.
   */
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PAGE_TIMEOUT_MS = 30 * 1000;

/** Default route shape for a feature when the script doesn't override. */
function defaultRoute(featureType: D5FeatureType): string {
  return `/demos/${featureType}`;
}

/** True when the registered featureType set still has wave-2b gaps. */
const ALL_KNOWN_FEATURES: readonly D5FeatureType[] = [
  "agentic-chat",
  "tool-rendering",
  "shared-state-read",
  "shared-state-write",
  "hitl-approve-deny",
  "hitl-text-input",
  "gen-ui-headless",
  "gen-ui-custom",
  "mcp-apps",
  "subagents",
] as const;

function isKnownFeatureType(value: string): value is D5FeatureType {
  return (ALL_KNOWN_FEATURES as readonly string[]).includes(value);
}

/**
 * Default Playwright-backed launcher. Mirrors the e2e-demos driver
 * pattern. The wrapper layer normalises the playwright Page to the
 * conversation-runner `Page` interface — playwright's Page satisfies
 * that structurally, so the cast is safe.
 */
const defaultLauncher: E2eDeepBrowserLauncher =
  async (): Promise<E2eDeepBrowser> => {
    const mod = (await import("playwright")) as typeof import("playwright");
    const browser = await mod.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return {
      async newContext(): Promise<E2eDeepBrowserContext> {
        const ctx = await browser.newContext();
        return {
          async newPage(): Promise<E2eDeepPage> {
            const page = await ctx.newPage();
            // Playwright's Page satisfies E2eDeepPage structurally:
            // waitForSelector / fill / press / evaluate (Page) + goto /
            // close (E2eDeepPage). The double-cast through unknown is
            // necessary because TypeScript can't see the structural
            // compatibility through Playwright's overloads.
            return page as unknown as E2eDeepPage;
          },
          close: () => ctx.close(),
        };
      },
      close: () => browser.close(),
    };
  };

/**
 * Default script loader — scans `<driverDir>/../scripts/` for files
 * matching `^d5-.*\.(js|ts)$` and imports each. Each file's top-level
 * `registerD5Script(...)` populates the registry as a side effect.
 *
 * Empty / missing directory → log a warning and return cleanly. Wave
 * 2b scripts haven't shipped yet; the driver must still typecheck and
 * run smoke-style tests before any are registered.
 *
 * NB: this scanner is intentionally NOT recursive — Wave 2b script
 * authors place files directly under `scripts/`, never under
 * `scripts/test/fixtures/` (which would be picked up here and break
 * the registry).
 */
const defaultScriptLoader: E2eDeepScriptLoader = async (
  ctx: ProbeContext,
): Promise<void> => {
  // Resolve the scripts directory relative to THIS module's compiled
  // location. In production this lands at `dist/probes/drivers/...`,
  // so `../../probes/scripts` ≡ `dist/probes/scripts`. The path is
  // relative to the source file via import.meta.url so dev (tsx) and
  // prod (compiled .js) both resolve correctly.
  const here = fileURLToPath(import.meta.url);
  const scriptsDir = path.resolve(path.dirname(here), "..", "scripts");

  let entries: string[];
  try {
    entries = await fs.readdir(scriptsDir);
  } catch (err) {
    ctx.logger.warn("probe.e2e-deep.scripts-dir-missing", {
      scriptsDir,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const matcher = /^d5-.*\.(js|ts)$/;
  const matched = entries.filter((name) => matcher.test(name));
  if (matched.length === 0) {
    ctx.logger.warn("probe.e2e-deep.no-scripts-found", { scriptsDir });
    return;
  }

  for (const name of matched) {
    const url = pathToFileURL(path.join(scriptsDir, name)).href;
    try {
      // Side-effect import — the script's top-level `registerD5Script`
      // call lands in the module-level registry.
      await import(url);
    } catch (err) {
      ctx.logger.error("probe.e2e-deep.script-import-failed", {
        scriptsDir,
        name,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

export function createE2eDeepDriver(
  deps: E2eDeepDriverDeps = {},
): ProbeDriver<E2eDeepDriverInput, E2eDeepAggregateSignal> {
  const launcher = deps.launcher ?? defaultLauncher;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pageTimeoutMs = deps.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const scriptLoader = deps.scriptLoader ?? defaultScriptLoader;

  return {
    kind: "e2e_deep",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: E2eDeepDriverInput,
    ): Promise<ProbeResult<E2eDeepAggregateSignal>> {
      const observedAt = ctx.now().toISOString();
      const backendUrl = (input.backendUrl ?? input.publicUrl)!;
      const slug = deriveSlug(input.key, input.name);

      // Starter short-circuit. Starters have no /demos routing → fan-
      // out would 404 every feature. Mirrors e2e-demos / e2e-smoke.
      if (input.shape === "starter") {
        return {
          key: input.key,
          state: "green",
          signal: {
            shape: "starter",
            slug,
            backendUrl,
            total: 0,
            passed: 0,
            failed: [],
            skipped: [],
            note: "starter: no /demos/* routing",
          },
          observedAt,
        };
      }

      // Filter the integration's declared features to known D5 feature
      // types. Anything else (e.g. legacy `e2e-features` ids that map
      // to demo routes but not to a D5 conversation) is silently
      // dropped — D5 covers a closed set.
      const requestedFeatures = (input.features ?? []).filter(
        isKnownFeatureType,
      );

      if (requestedFeatures.length === 0) {
        return {
          key: input.key,
          state: "green",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            total: 0,
            passed: 0,
            failed: [],
            skipped: [],
            note: "no D5 features declared",
          },
          observedAt,
        };
      }

      // Populate the registry. Idempotent in tests via the injected
      // loader; production loader scans the scripts dir on each call,
      // but the registry's double-registration throw guards against
      // accidental re-population (the loader catches the throw and
      // logs it — see defaultScriptLoader).
      try {
        await scriptLoader(ctx);
      } catch (err) {
        ctx.logger.warn("probe.e2e-deep.script-loader-failed", {
          slug,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // Partition features into "registered" (script available) vs
      // "skipped" (no script). The skipped set short-circuits before
      // chromium so we don't pay for a launch per slug when Wave 2b
      // hasn't landed yet.
      const skipped: string[] = [];
      const runnable: D5FeatureType[] = [];
      for (const ft of requestedFeatures) {
        if (D5_REGISTRY.has(ft)) {
          runnable.push(ft);
        } else {
          skipped.push(ft);
        }
      }

      // Skipped-only short-circuit. Aggregate green (no failure), but
      // emit one side row per skipped feature so the dashboard cell
      // shows a definite "no-script-yet" badge instead of going gray.
      if (runnable.length === 0) {
        for (const ft of skipped) {
          await sideEmit(ctx, {
            key: `d5:${slug}/${ft}`,
            state: "green",
            signal: {
              slug,
              featureType: ft,
              backendUrl,
              note: "no script registered for featureType",
            },
            observedAt: ctx.now().toISOString(),
          });
        }
        return {
          key: input.key,
          state: "green",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            total: requestedFeatures.length,
            passed: 0,
            failed: [],
            skipped,
            note: "no scripts registered for any declared feature",
          },
          observedAt,
        };
      }

      // Hard-timeout + abort plumbing — same shape as e2e-demos so
      // operators see consistent abort/timeout signals across drivers.
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
        if (externalAbort.aborted) abort.abort();
        else
          externalAbort.addEventListener("abort", onExternalAbort, {
            once: true,
          });
      }

      let browser: E2eDeepBrowser | undefined;
      try {
        try {
          browser = await launcher();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn("probe.e2e-deep.launcher-error", { slug, err: msg });
          return {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              total: requestedFeatures.length,
              passed: 0,
              failed: [],
              skipped,
              errorDesc: "launcher-error",
              failureSummary: truncateUtf8(msg, 1200),
            },
            observedAt,
          };
        }

        // Skipped features get their side rows written upfront so
        // dashboards never see a missing badge between runnable
        // features executing.
        for (const ft of skipped) {
          await sideEmit(ctx, {
            key: `d5:${slug}/${ft}`,
            state: "green",
            signal: {
              slug,
              featureType: ft,
              backendUrl,
              note: "no script registered for featureType",
            },
            observedAt: ctx.now().toISOString(),
          });
        }

        const failed: string[] = [];
        let passed = 0;

        for (const ft of runnable) {
          const sideKey = `d5:${slug}/${ft}`;
          const script = D5_REGISTRY.get(ft)!;
          const route = (script.preNavigateRoute ?? defaultRoute)(ft);
          const url = `${backendUrl}${route}`;

          if (abort.signal.aborted) {
            failed.push(ft);
            await sideEmit(ctx, {
              key: sideKey,
              state: "red",
              signal: {
                slug,
                featureType: ft,
                backendUrl,
                url,
                fixtureFile: script.fixtureFile,
                errorClass: "abort",
                errorDesc: timedOut
                  ? `timeout after ${timeoutMs}ms`
                  : "aborted",
              },
              observedAt: ctx.now().toISOString(),
            });
            continue;
          }

          const featureResult = await runFeature({
            browser,
            url,
            pageTimeoutMs,
            script,
            buildCtx: {
              integrationSlug: slug,
              featureType: ft,
              baseUrl: backendUrl,
            },
            abortSignal: abort.signal,
          });

          if (featureResult.ok) {
            passed++;
            await sideEmit(ctx, {
              key: sideKey,
              state: "green",
              signal: {
                slug,
                featureType: ft,
                backendUrl,
                url,
                fixtureFile: script.fixtureFile,
                turns_completed: featureResult.conversation.turns_completed,
                total_turns: featureResult.conversation.total_turns,
                turn_durations_ms: featureResult.conversation.turn_durations_ms,
              },
              observedAt: ctx.now().toISOString(),
            });
          } else {
            failed.push(ft);
            await sideEmit(ctx, {
              key: sideKey,
              state: "red",
              signal: {
                slug,
                featureType: ft,
                backendUrl,
                url,
                fixtureFile: script.fixtureFile,
                turns_completed: featureResult.conversation?.turns_completed,
                total_turns: featureResult.conversation?.total_turns,
                failure_turn: featureResult.conversation?.failure_turn,
                turn_durations_ms:
                  featureResult.conversation?.turn_durations_ms,
                errorDesc: featureResult.errorDesc,
                errorClass: featureResult.errorClass,
              },
              observedAt: ctx.now().toISOString(),
            });
          }
        }

        const aggregateGreen = failed.length === 0;
        return {
          key: input.key,
          state: aggregateGreen ? "green" : "red",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            total: requestedFeatures.length,
            passed,
            failed,
            skipped,
          },
          observedAt,
        };
      } finally {
        clearTimeout(timeoutHandle);
        if (externalAbort) {
          externalAbort.removeEventListener("abort", onExternalAbort);
        }
        if (browser) {
          try {
            await browser.close();
          } catch (err) {
            ctx.logger.warn("probe.e2e-deep.browser-close-failed", {
              slug,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },
  };
}

/**
 * Per-feature run: open a fresh browser context, navigate, build turns,
 * run the conversation. Fresh context per feature so cookies /
 * localStorage from one feature can't leak into the next. Context is
 * closed in the finally block so a hung conversation doesn't orphan
 * resources.
 */
async function runFeature(opts: {
  browser: E2eDeepBrowser;
  url: string;
  pageTimeoutMs: number;
  script: D5Script;
  buildCtx: D5BuildContext;
  abortSignal: AbortSignal;
}): Promise<
  | { ok: true; conversation: ConversationResult }
  | {
      ok: false;
      errorClass: string;
      errorDesc: string;
      conversation?: ConversationResult;
    }
> {
  const { browser, url, pageTimeoutMs, script, buildCtx, abortSignal } = opts;
  if (abortSignal.aborted) {
    return {
      ok: false,
      errorClass: "abort",
      errorDesc: "aborted before start",
    };
  }

  let context: E2eDeepBrowserContext | undefined;
  let page: E2eDeepPage | undefined;
  try {
    context = await browser.newContext();
    page = await context.newPage();

    // Navigate. The conversation-runner's first action is a
    // chat-input selector probe with its own short timeout, so we
    // don't need to waitForSelector again here — a clean goto is
    // sufficient.
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: pageTimeoutMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        errorClass: "goto-error",
        errorDesc: truncateUtf8(msg, 1200),
      };
    }

    const turns = script.buildTurns(buildCtx);
    const conversation = await runConversation(page, turns);

    if (conversation.failure_turn !== undefined) {
      return {
        ok: false,
        errorClass: "conversation-error",
        errorDesc: truncateUtf8(
          conversation.error ?? "conversation failed without error message",
          1200,
        ),
        conversation,
      };
    }

    return { ok: true, conversation };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errorClass: abortSignal.aborted ? "abort" : "driver-error",
      errorDesc: truncateUtf8(msg, 1200),
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* context.close() picks up remnants */
      }
    }
    if (context) {
      try {
        await context.close();
      } catch {
        /* browser.close() in outer finally picks up remnants */
      }
    }
  }
}

async function sideEmit(
  ctx: ProbeContext,
  result: ProbeResult<E2eDeepFeatureSignal>,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.e2e-deep.writer-missing", { key: result.key });
    return;
  }
  try {
    await ctx.writer.write(result);
  } catch (err) {
    ctx.logger.error("probe.e2e-deep.side-emit-writer-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Mirrors e2e-demos's deriveSlug so operators get one consistent
 * "what's the slug for this row" mental model across drivers.
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
  return raw.startsWith("showcase-") ? raw.slice("showcase-".length) : raw;
}

/** Default driver instance — registered by the orchestrator at boot. */
export const e2eDeepDriver = createE2eDeepDriver();
