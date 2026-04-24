import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { truncateUtf8 } from "../../render/filters.js";
import { showcaseShapeSchema } from "../discovery/railway-services.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Phase 4B.1 — e2e-demos driver.
 *
 * Fans out across every declared demo of a showcase service and emits one
 * `e2e:<slug>/<featureId>` side row per demo, plus an aggregate primary
 * `e2e-demos:<slug>` result. Unlike `e2e-smoke` (which runs a focused L3/L4
 * chat round-trip against two specific demos), this driver visits EVERY
 * `/demos/<featureId>` route declared in the registry and asserts that the
 * page reaches a structural "ready" state (the CopilotKit chat input
 * rendering). The dashboard's per-cell `e2e:<slug>/<featureId>` lookup
 * (see `shell-dashboard/src/lib/live-status.ts#resolveCell` /
 * `keyFor("e2e", slug, featureId)`) consumes each side row.
 *
 * Why a second driver instead of extending e2e-smoke:
 *   - e2e-smoke is expensive (chat round-trip, LLM inference per demo) and
 *     targeted at the two canonical demos. Running it on every demo would
 *     multiply infra cost by ~20x per service.
 *   - e2e-demos is cheap (goto + structural selector) and is the right
 *     granularity for per-cell green/red dots on the dashboard matrix.
 *
 * Structural signal:
 *   - Prefer `[data-testid="copilot-chat-input"]` (the canonical testid the
 *     CopilotKit React packages emit).
 *   - Fallback to `input[placeholder="Type a message"]` for showcases that
 *     haven't yet added the testid.
 *   - Final fallback: navigation succeeding (no thrown page.goto) is
 *     considered structurally green — better than false-red for services
 *     whose chat UI uses a different DOM shape but still loads cleanly.
 *
 * Shape handling: starters short-circuit green BEFORE chromium launch, same
 * as the e2e-smoke driver — starters have no `/demos/*` routing so running
 * a goto against `/demos/<x>` would 404 and flap every cell red. Empty
 * demos list also short-circuits without touching chromium.
 *
 * Pluggable launcher: production default dynamically imports `playwright`;
 * unit tests inject a fake launcher + fake page so no real browser is
 * required. Mirrors the e2e-smoke pattern for consistency.
 */

const inputSchema = z
  .object({
    key: z.string().min(1),
    backendUrl: z.string().url().optional(),
    publicUrl: z.string().url().optional(),
    name: z.string().optional(),
    demos: z.array(z.string()).optional(),
    shape: showcaseShapeSchema.optional(),
  })
  .passthrough()
  .refine((v) => !!(v.backendUrl ?? v.publicUrl), {
    message: "backendUrl or publicUrl is required",
    path: ["backendUrl"],
  });

type E2eDemosDriverInput = z.infer<typeof inputSchema>;

/**
 * Aggregate signal carried on the primary `e2e-demos:<slug>` ProbeResult.
 *
 *   - `shape: "starter"` — driver short-circuited before launching
 *     chromium. `total` and `passed` are always 0, `failed` empty, `note`
 *     carries the human-readable reason. Green aggregate.
 *   - `shape: "package"` — normal fan-out. `failed` lists the demo ids
 *     that flipped red. `errorDesc` may be set on aggregate-level failures
 *     (e.g. chromium launch failure) where no per-demo rows were produced.
 */
export interface E2eDemosAggregateSignal {
  shape: "package" | "starter";
  slug: string;
  backendUrl: string;
  total: number;
  passed: number;
  failed: string[];
  note?: string;
  /**
   * Present only on aggregate-level failures that prevented per-demo
   * checks from running (e.g. `"launcher-error"` when chromium itself
   * failed to launch). Keyed vocabulary so alert rules / dashboards can
   * branch on a stable discriminator instead of parsing prose.
   */
  errorDesc?: string;
  /** Free-form failure detail for aggregate-level failures. */
  failureSummary?: string;
}

/** Per-demo side-emit signal carried on each `e2e:<slug>/<featureId>` row. */
export interface E2eDemosFeatureSignal {
  slug: string;
  featureId: string;
  backendUrl: string;
  /**
   * Canonical URL the probe navigated to. Absent for informational cells
   * (demos without a `route:` field in the registry — e.g. `cli-start`,
   * which is a command-cell with a `command:` field and no UI route).
   * Those rows short-circuit green without a goto, so `url` is omitted
   * rather than synthesised against a non-existent path.
   */
  url?: string;
  /**
   * Free-form note describing why a green row was emitted without a goto
   * (e.g. `"informational cell, skipped goto"`). Absent on rows that
   * actually exercised a navigation.
   */
  note?: string;
  /**
   * Human-readable failure message on red rows. Carries the underlying
   * error text (e.g. `"net::ERR_CONNECTION_REFUSED"`, playwright timeout
   * message, selector-not-found) truncated to the Slack-safe budget. The
   * dashboard and alert templates render this as the failure reason;
   * keyed taxonomy (goto vs selector vs abort) lives on `errorClass`.
   */
  errorDesc?: string;
  /** Keyed failure class: `"goto-error"`, `"selector-error"`, `"abort"`. */
  errorClass?: string;
}

/**
 * Minimal Page surface the driver relies on. Mirrors e2e-smoke's E2ePage
 * but trimmed to the two calls this driver actually makes (goto +
 * waitForSelector). Separate name so the two drivers' type tree stays
 * independent — a future change to e2e-smoke's surface won't leak here.
 */
export interface E2eDemosPage {
  goto(
    url: string,
    opts?: { waitUntil?: "networkidle" | "domcontentloaded"; timeout?: number },
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    opts?: { timeout?: number; state?: "visible" },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface E2eDemosBrowserContext {
  newPage(): Promise<E2eDemosPage>;
  close(): Promise<void>;
}

export interface E2eDemosBrowser {
  newContext(): Promise<E2eDemosBrowserContext>;
  close(): Promise<void>;
}

export type E2eDemosBrowserLauncher = () => Promise<E2eDemosBrowser>;

/**
 * Per-demo metadata surfaced by the resolver. `route` is the path segment
 * the driver navigates to (e.g. `/demos/agentic-chat`); absence means the
 * demo is an informational cell (e.g. `cli-start` — a command-cell with
 * a `command:` field and no UI route) and must be short-circuited green
 * without a goto. Keep this intentionally narrow: adding new fields here
 * widens the resolver contract and would force all callers (including the
 * in-band `input.demos` path) to change.
 */
export interface E2eDemoEntry {
  id: string;
  /** Route path (e.g. `/demos/agentic-chat`). Absent → informational cell. */
  route?: string;
}

/**
 * Resolver that maps a service slug to its declared demos (registry
 * lookup). Returns the richer `E2eDemoEntry` shape so the driver can
 * distinguish demos that should be navigated to from informational cells
 * that have no UI route.
 */
export type E2eDemosResolver = (slug: string) => Promise<E2eDemoEntry[]>;

export interface E2eDemosDriverDeps {
  launcher?: E2eDemosBrowserLauncher;
  pageTimeoutMs?: number;
  timeoutMs?: number;
  demosResolver?: E2eDemosResolver;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PAGE_TIMEOUT_MS = 30 * 1000;

/**
 * Structural-ready selectors tried in order. First match wins; a demo is
 * considered green if any one resolves within the page timeout. Kept as a
 * const array so the production config and the unit tests agree on the
 * exact ordering — a refactor that re-orders the list surfaces as a test
 * diff.
 *
 * Ordering rationale:
 *   1. CopilotKit canonical testid — deterministic, the strictest signal.
 *   2. Default placeholder — covers CopilotKit UIs that haven't yet added
 *      the testid.
 *   3-5. Generic chat-affordance fallbacks. Custom-composer demos (e.g.
 *      `headless-simple`, `headless-complete`) build their own UI on top
 *      of `useAgent`, so they lack both the testid and the default
 *      placeholder but still render a `textarea` / text input / ARIA
 *      textbox. A match on any of these is enough structural evidence
 *      that the demo route booted.
 */
const READY_SELECTORS = [
  '[data-testid="copilot-chat-input"]',
  'input[placeholder="Type a message"]',
  "textarea",
  'input[type="text"]',
  '[role="textbox"]',
] as const;

const defaultLauncher: E2eDemosBrowserLauncher =
  async (): Promise<E2eDemosBrowser> => {
    const mod = (await import("playwright")) as typeof import("playwright");
    const browser = await mod.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return {
      async newContext(): Promise<E2eDemosBrowserContext> {
        const ctx = await browser.newContext();
        return {
          async newPage(): Promise<E2eDemosPage> {
            const page = await ctx.newPage();
            return {
              goto: (url, opts) => page.goto(url, opts),
              waitForSelector: (sel, opts) => page.waitForSelector(sel, opts),
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
 * Default demos resolver. Reads `registry.json` once (memoised in-closure)
 * and extracts `integrations[].slug → demos[].id`. Production runtime gets
 * the file from `/app/data/registry.json` (copied in by the Dockerfile);
 * tests override via `REGISTRY_JSON_PATH` on ctx.env. Returns `[]` on any
 * read/parse error — a misconfigured runtime image should degrade to
 * "nothing to check, green aggregate" rather than flapping every service
 * red every tick.
 */
function createDefaultDemosResolver(
  env: Readonly<Record<string, string | undefined>>,
): E2eDemosResolver {
  let cache: Map<string, E2eDemoEntry[]> | null = null;
  return async (slug: string): Promise<E2eDemoEntry[]> => {
    if (cache === null) {
      const override = env.REGISTRY_JSON_PATH;
      const fallback = path.resolve("/app/data/registry.json");
      const registryPath = override ?? fallback;
      try {
        const raw = await fs.readFile(registryPath, "utf-8");
        const parsed = JSON.parse(raw) as {
          integrations?: Array<{
            slug?: string;
            demos?: Array<{ id?: string; route?: string }>;
          }>;
        };
        const map = new Map<string, E2eDemoEntry[]>();
        for (const it of parsed.integrations ?? []) {
          if (!it.slug) continue;
          const entries: E2eDemoEntry[] = [];
          for (const d of it.demos ?? []) {
            if (typeof d.id !== "string") continue;
            entries.push({
              id: d.id,
              route: typeof d.route === "string" ? d.route : undefined,
            });
          }
          map.set(it.slug, entries);
        }
        cache = map;
      } catch {
        cache = new Map();
      }
    }
    return cache.get(slug) ?? [];
  };
}

export function createE2eDemosDriver(
  deps: E2eDemosDriverDeps = {},
): ProbeDriver<E2eDemosDriverInput, E2eDemosAggregateSignal> {
  const launcher = deps.launcher ?? defaultLauncher;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pageTimeoutMs = deps.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;

  return {
    kind: "e2e_demos",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: E2eDemosDriverInput,
    ): Promise<ProbeResult<E2eDemosAggregateSignal>> {
      const observedAt = ctx.now().toISOString();
      const backendUrl = (input.backendUrl ?? input.publicUrl)!;
      const slug = deriveSlug(input.key, input.name);

      // Starter short-circuit — runs BEFORE chromium launch AND BEFORE
      // demos resolution. Starters have no /demos/* routing, so every row
      // would 404 and flap red. The ordering lock (shape check before
      // resolver) mirrors e2e-smoke so a broken registry / missing
      // chromium image never contributes a false-red row on a starter.
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
            note: "starter: no /demos/* routing",
          },
          observedAt,
        };
      }

      // Lazy resolver — build the default only if we actually need one, so
      // tests that inject `demos: [...]` in-band never touch the
      // filesystem.
      const demosResolver =
        deps.demosResolver ?? createDefaultDemosResolver(ctx.env);

      // Demos resolution: (1) in-band `input.demos`, (2) registry lookup.
      // In-band ids synthesise a canonical `/demos/<id>` route so existing
      // static-YAML callers and tests keep their current behaviour without
      // having to restate the route. Registry-backed lookups carry the
      // real `route:` field verbatim so informational cells (no route)
      // can be distinguished from navigable demos.
      let demos: E2eDemoEntry[];
      if (Array.isArray(input.demos)) {
        demos = input.demos.map((id) => ({ id, route: `/demos/${id}` }));
      } else {
        try {
          demos = await demosResolver(slug);
        } catch (err) {
          ctx.logger.warn("probe.e2e-demos.demos-resolve-failed", {
            slug,
            err: err instanceof Error ? err.message : String(err),
          });
          demos = [];
        }
      }

      // Empty demos set → nothing to check, aggregate green, chromium NOT
      // launched. Starter-only integrations or brand-new packages still
      // being scaffolded land here.
      if (demos.length === 0) {
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
            note: "no demos declared",
          },
          observedAt,
        };
      }

      // Arm the driver's own hard-timeout plus the invoker-supplied abort
      // signal so page.close() / browser.close() get a prompt shutdown
      // signal when the tick runs long. Mirrors e2e-smoke's plumbing.
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

      let browser: E2eDemosBrowser | undefined;
      try {
        try {
          browser = await launcher();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn("probe.e2e-demos.launcher-error", { slug, err: msg });
          return {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              total: demos.length,
              passed: 0,
              failed: [],
              errorDesc: "launcher-error",
              failureSummary: truncateUtf8(msg, 1200),
            },
            observedAt,
          };
        }

        const failed: string[] = [];
        let passed = 0;
        for (const demo of demos) {
          const featureId = demo.id;
          const sideKey = `e2e:${slug}/${featureId}`;

          // Informational cells (no `route:` in the registry — e.g.
          // `cli-start`, a command-cell with a `command:` field and no
          // UI route) short-circuit green without a goto. Navigating
          // `/demos/cli-start` would hit the shell's 404 route and
          // selector-timeout red every tick. The side row still emits so
          // the dashboard shows a green dot per cell rather than gray,
          // and carries a `note` so operators can tell at a glance why
          // the probe didn't exercise the page.
          if (!demo.route) {
            passed++;
            await sideEmit(ctx, {
              key: sideKey,
              state: "green",
              signal: {
                slug,
                featureId,
                backendUrl,
                note: "informational cell, skipped goto",
              },
              observedAt: ctx.now().toISOString(),
            });
            continue;
          }

          const url = `${backendUrl}${demo.route}`;

          if (abort.signal.aborted) {
            // Timeout / external abort fired mid-fan-out. Mark remaining
            // demos red via the side-emit path so the dashboard still
            // shows a signal per cell rather than going gray, then break.
            failed.push(featureId);
            await sideEmit(ctx, {
              key: sideKey,
              state: "red",
              signal: {
                slug,
                featureId,
                backendUrl,
                url,
                errorClass: "abort",
                errorDesc: timedOut
                  ? `timeout after ${timeoutMs}ms`
                  : "aborted",
              },
              observedAt: ctx.now().toISOString(),
            });
            continue;
          }

          const demoResult = await runDemo({
            browser,
            url,
            pageTimeoutMs,
            abortSignal: abort.signal,
          });

          if (demoResult.ok) {
            passed++;
            await sideEmit(ctx, {
              key: sideKey,
              state: "green",
              signal: { slug, featureId, backendUrl, url },
              observedAt: ctx.now().toISOString(),
            });
          } else {
            failed.push(featureId);
            await sideEmit(ctx, {
              key: sideKey,
              state: "red",
              signal: {
                slug,
                featureId,
                backendUrl,
                url,
                errorDesc: demoResult.errorDesc,
                errorClass: demoResult.errorClass,
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
            total: demos.length,
            passed,
            failed,
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
            ctx.logger.warn("probe.e2e-demos.browser-close-failed", {
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
 * Per-demo check: open a fresh context/page, navigate, wait for any one of
 * the structural selectors. Fresh context per demo so cookies/localStorage
 * from one demo don't contaminate the next — matches e2e-smoke's per-level
 * isolation. Context is closed in the finally block even on assertion
 * failure, so a hanging demo doesn't orphan a context that would block
 * the next demo.
 */
async function runDemo(opts: {
  browser: E2eDemosBrowser;
  url: string;
  pageTimeoutMs: number;
  abortSignal: AbortSignal;
}): Promise<
  { ok: true } | { ok: false; errorClass: string; errorDesc: string }
> {
  const { browser, url, pageTimeoutMs, abortSignal } = opts;
  if (abortSignal.aborted) {
    return {
      ok: false,
      errorClass: "abort",
      errorDesc: "aborted before start",
    };
  }

  let context: E2eDemosBrowserContext | undefined;
  let page: E2eDemosPage | undefined;
  try {
    context = await browser.newContext();
    page = await context.newPage();
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

    // Try each structural selector in order; first match wins. Neither
    // matching is surfaced as a selector-error so operators can spot
    // which demos need a testid added. Keeping the error taxonomy
    // distinct from a navigation failure lets alert rules branch on
    // `errorClass` without string-matching prose.
    let lastError: Error | undefined;
    for (const sel of READY_SELECTORS) {
      try {
        await page.waitForSelector(sel, {
          state: "visible",
          timeout: pageTimeoutMs,
        });
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    return {
      ok: false,
      errorClass: "selector-error",
      errorDesc: truncateUtf8(
        lastError?.message ?? "ready selectors not found",
        1200,
      ),
    };
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

/**
 * Emit a per-demo side-row through ctx.writer. Absent writer is
 * logged-and-skipped. Writer throws are non-fatal — a side-emit hiccup
 * must not take the aggregate tick down with it.
 */
async function sideEmit(
  ctx: ProbeContext,
  result: ProbeResult<E2eDemosFeatureSignal>,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.e2e-demos.writer-missing", { key: result.key });
    return;
  }
  try {
    await ctx.writer.write(result);
  } catch (err) {
    ctx.logger.error("probe.e2e-demos.side-emit-writer-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Derive the service slug for side-emit keys and registry lookup.
 * Preference:
 *   1. Everything after `:` in `input.key` (matches YAML dedupe key).
 *   2. `input.name` with `showcase-` prefix stripped.
 *   3. Whole key as fallback.
 * Mirrors e2e-smoke's deriveSlug so operators get one consistent mental
 * model across drivers.
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
export const e2eDemosDriver = createE2eDemosDriver();
