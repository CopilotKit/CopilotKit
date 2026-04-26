import { promises as fs } from "node:fs";
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
  type Page as RunnerPage,
} from "../helpers/conversation-runner.js";
import {
  attachSseInterceptor as defaultAttachSseInterceptor,
  type SseCapture,
  type SseInterceptorHandle,
} from "../helpers/sse-interceptor.js";
import {
  buildSnapshot,
  serializeRelevantDom,
  type ReferenceCapturePage,
} from "../helpers/reference-capture.js";
import {
  compareParity,
  DEFAULT_PARITY_TOLERANCES,
  type ParityReport,
  type ParitySnapshot,
  type ParityTolerances,
} from "../helpers/parity-compare.js";
import {
  loadReferenceSnapshot,
  selectD6Targets,
  type LoadReferenceResult,
} from "../helpers/d6-scoping.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page as PlaywrightPage } from "playwright";

/**
 * D6 — e2e-parity driver.
 *
 * Wires B10 (SSE interceptor) + B11 (parity-compare) + B12 (reference-
 * capture serialize/buildSnapshot) into an executable probe. Each tick
 * picks ONE integration via the scoping helper (weekly-rotation by
 * default; on-demand via env), runs every featureType for that
 * integration through a D5 conversation, captures a live `ParitySnapshot`,
 * compares against the on-disk reference, and emits one
 * `d6:<slug>/<featureType>` row per featureType to the same `status`
 * collection D5 uses (Q5 of the spec — distinguished only by the `d6:`
 * key prefix).
 *
 * State mapping per spec:
 *   - green  — all 4 axes pass (`report.overall === "pass"`).
 *   - amber  — 1-2 axes failed (degraded but not catastrophic).
 *   - red    — 3-4 axes failed.
 *
 * Showcase-ops' status pipeline doesn't have a native amber slot — only
 * `green` / `red` / `degraded` exist on the State enum. We map amber →
 * `degraded` so dashboards that branch on the State enum get a
 * distinguishable middle bucket without forcing a schema change. The
 * `signal.severity` field carries the original "amber" label for
 * humans who want it.
 *
 * Skip semantics (per spec):
 *   - No script registered for featureType → green row, note
 *     `"no script registered"` (Wave 2b coverage gap, NOT a regression).
 *   - No reference snapshot on disk for featureType → green row, note
 *     `"no reference snapshot"` (operator hasn't captured yet — driver
 *     is read-only against the reference set, capture is a separate
 *     CLI per `scripts/d6-capture-references.ts`).
 *
 * Concurrency: featureTypes for a single integration run sequentially
 * within ONE driver invocation. The `max_concurrency: 2` from the YAML
 * applies at the invoker level (parallel driver invocations across
 * multiple integrations) — but in weekly-rotation mode there's only
 * ever one integration per tick, so the cap is effectively a safety
 * rail for on-demand floods rather than a normal-path knob.
 *
 * Pluggable launcher + interceptor + DOM serializer + reference loader:
 * tests inject fakes for ALL of them so unit tests run with no chromium,
 * no filesystem, no CDP.
 */

const inputSchema = z
  .object({
    key: z.string().min(1),
    backendUrl: z.string().url().optional(),
    publicUrl: z.string().url().optional(),
    name: z.string().optional(),
    /**
     * The list of D5 feature types this integration declares. The driver
     * only compares featureTypes that are BOTH (a) on this list and
     * (b) registered in `D5_REGISTRY` and (c) have an on-disk reference
     * snapshot. Anything missing from any of those three lists is
     * skipped with a green note row.
     */
    features: z.array(z.string()).optional(),
    shape: showcaseShapeSchema.optional(),
  })
  .passthrough()
  .refine((v) => !!(v.backendUrl ?? v.publicUrl), {
    message: "backendUrl or publicUrl is required",
    path: ["backendUrl"],
  });

type E2eParityDriverInput = z.infer<typeof inputSchema>;

/**
 * Aggregate signal carried on the primary `e2e-parity:<slug>` ProbeResult.
 *
 *   - `shape: "starter"` — short-circuit before launch.
 *   - `mode` — the resolved scoping mode (weekly-rotation | on-demand).
 *   - `scopingReason` — human-readable explanation of WHY this slug ran
 *     this tick (or didn't). Surfaced verbatim in dashboards / Slack.
 *   - `selectedThisTick` — `true` when this slug was picked by the
 *     scoping logic (ran the comparison); `false` when it sat out the
 *     tick (weekly-rotation skipped it). Driver returns aggregate green
 *     with `selectedThisTick: false` so non-target slugs don't flap red.
 *   - `axisFailures` — total axis failures across all featureTypes
 *     (sum of `report.failure_count`). Useful for dashboards that want
 *     a single severity number.
 */
export interface E2eParityAggregateSignal {
  shape: "package" | "starter";
  slug: string;
  backendUrl: string;
  mode: "weekly-rotation" | "on-demand";
  selectedThisTick: boolean;
  scopingReason: string;
  total: number;
  passed: number;
  amber: number;
  red: number;
  skipped: string[];
  axisFailures: number;
  note?: string;
  errorDesc?: string;
  failureSummary?: string;
}

/**
 * Per-feature side-emit signal carried on each `d6:<slug>/<featureType>`
 * row. Includes the FULL parity `report.details` so the dashboard can
 * drill into per-axis failure reasons without a re-run.
 *
 * `severity` carries the original 3-state verdict (`"green" | "amber" | "red"`)
 * as a human-readable label even though the row's `state` is the ProbeState
 * mapping (amber → `degraded`).
 */
export interface E2eParityFeatureSignal {
  slug: string;
  featureType: string;
  backendUrl: string;
  url?: string;
  fixtureFile?: string;
  severity?: "green" | "amber" | "red";
  axes?: ParityReport["axes"];
  axisFailures?: number;
  details?: ParityReport["details"];
  /** Snapshot path used as the reference for this comparison. */
  referencePath?: string;
  errorDesc?: string;
  errorClass?: string;
  note?: string;
}

/* ─── Browser surface (mirrors e2e-deep + reference-capture) ─────── */

/**
 * Page surface the driver depends on. Combines the conversation-runner's
 * `Page` (selector / fill / press / evaluate) with `goto` / `close` and
 * — critically — the playwright `context()` accessor required by the
 * SSE interceptor's CDP attach. The default launcher returns a real
 * `playwright.Page`; tests inject a fake that satisfies the full surface.
 */
export interface E2eParityPage extends ReferenceCapturePage {
  /**
   * Optional escape hatch back to the underlying `playwright.Page` so
   * the interceptor injection can call `attachSseInterceptor(page)` with
   * the strict signature. Tests inject a stub interceptor and never
   * touch this getter; production wires it through.
   */
  asPlaywrightPage?: () => PlaywrightPage;
}

export interface E2eParityBrowserContext {
  newPage(): Promise<E2eParityPage>;
  close(): Promise<void>;
}

export interface E2eParityBrowser {
  newContext(): Promise<E2eParityBrowserContext>;
  close(): Promise<void>;
}

export type E2eParityBrowserLauncher = () => Promise<E2eParityBrowser>;

/** SSE interceptor injection. Tests stub; default = the real CDP one. */
export type E2eParityAttachInterceptor = (
  page: E2eParityPage,
) => Promise<SseInterceptorHandle>;

/** DOM serializer injection. Tests stub; default = `serializeRelevantDom`. */
export type E2eParitySerializeDom = (
  page: E2eParityPage,
) => Promise<ParitySnapshot["domElements"]>;

/** Reference-snapshot loader injection. Tests stub; default = `loadReferenceSnapshot`. */
export type E2eParityLoadReference = (
  featureType: D5FeatureType,
  outputDir: string,
) => Promise<LoadReferenceResult>;

/** Conversation-runner injection. Tests stub; default = `runConversation`. */
export type E2eParityRunConversation = (
  page: E2eParityPage,
  turns: ReturnType<D5Script["buildTurns"]>,
) => Promise<ConversationResult>;

/**
 * Fleet resolver — produces the FULL list of D6-eligible integration
 * slugs the rotation walks across. Default reads `registry.json`
 * (mirroring e2e-demos's resolver pattern); tests inject a static list.
 */
export type E2eParityFleetResolver = (ctx: ProbeContext) => Promise<string[]>;

export interface E2eParityDriverDeps {
  launcher?: E2eParityBrowserLauncher;
  attachInterceptor?: E2eParityAttachInterceptor;
  serializeDom?: E2eParitySerializeDom;
  loadReference?: E2eParityLoadReference;
  runConversation?: E2eParityRunConversation;
  fleetResolver?: E2eParityFleetResolver;
  pageTimeoutMs?: number;
  timeoutMs?: number;
  /** Override tolerances. Tests use this to assert axis verdict mapping. */
  tolerances?: Partial<ParityTolerances>;
  /**
   * Override the directory the reference loader reads from. Defaults to
   * `<package>/fixtures/d6-reference/`. Tests inject a synthetic dir so
   * `loadReference` resolves to the test's fake.
   */
  referenceDir?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 600s — covers conversation + DOM serialize + compare
const DEFAULT_PAGE_TIMEOUT_MS = 30 * 1000;

/** Default route shape for a feature when the script doesn't override. */
function defaultRoute(featureType: D5FeatureType): string {
  return `/demos/${featureType}`;
}

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
 * Default reference-snapshot directory. Resolves to
 * `<package-root>/fixtures/d6-reference/` independent of cwd. Tests
 * override via `deps.referenceDir`.
 */
function defaultReferenceDir(): string {
  const here = fileURLToPath(import.meta.url);
  // src/probes/drivers/e2e-parity.ts → ../../../fixtures/d6-reference
  // dist/probes/drivers/e2e-parity.js → ../../../fixtures/d6-reference
  return path.resolve(
    path.dirname(here),
    "..",
    "..",
    "..",
    "fixtures",
    "d6-reference",
  );
}

/**
 * Default Playwright-backed launcher. Mirrors the e2e-deep pattern but
 * returns the unwrapped `playwright.Page` so the SSE interceptor can
 * `page.context().newCDPSession(page)`.
 */
const defaultLauncher: E2eParityBrowserLauncher =
  async (): Promise<E2eParityBrowser> => {
    const mod = (await import("playwright")) as typeof import("playwright");
    const browser = await mod.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return {
      async newContext(): Promise<E2eParityBrowserContext> {
        const ctx = await browser.newContext();
        return {
          async newPage(): Promise<E2eParityPage> {
            const page = await ctx.newPage();
            // Playwright's Page satisfies E2eParityPage structurally —
            // see the type above for the surface comment. Cast through
            // unknown because the structural compatibility isn't visible
            // through Playwright's overloads.
            const wrapped = page as unknown as E2eParityPage;
            wrapped.asPlaywrightPage = (): PlaywrightPage => page;
            return wrapped;
          },
          close: () => ctx.close(),
        };
      },
      close: () => browser.close(),
    };
  };

/**
 * Default SSE interceptor — pulls the Playwright Page out via
 * `asPlaywrightPage()` if the caller wired it (production path) and
 * falls back to assuming the page IS the Playwright Page (tests that
 * use real Playwright). Tests that stub the interceptor at
 * `deps.attachInterceptor` never reach this.
 */
const defaultAttachInterceptor: E2eParityAttachInterceptor = async (
  page,
): Promise<SseInterceptorHandle> => {
  const real = page.asPlaywrightPage?.() ?? (page as unknown as PlaywrightPage);
  return defaultAttachSseInterceptor(real);
};

const defaultSerializeDom: E2eParitySerializeDom = (page) =>
  serializeRelevantDom(page);

const defaultLoadReference: E2eParityLoadReference = (featureType, outputDir) =>
  loadReferenceSnapshot(featureType, outputDir);

const defaultRunConversation: E2eParityRunConversation = (page, turns) =>
  runConversation(page as RunnerPage, turns);

/**
 * Default fleet resolver — reads `registry.json` (same path
 * convention as e2e-demos) and returns every integration slug whose
 * `demos[]` contains at least one D5-eligible feature route. Returns
 * `[]` on any read/parse error so a misconfigured runtime image
 * degrades to "nothing selected, green aggregate" rather than
 * red-flapping every service.
 */
function createDefaultFleetResolver(): E2eParityFleetResolver {
  let cache: string[] | null = null;
  return async (ctx) => {
    if (cache !== null) return cache;
    const override = ctx.env.REGISTRY_JSON_PATH;
    const fallback = path.resolve("/app/data/registry.json");
    const registryPath = override ?? fallback;
    try {
      const raw = await fs.readFile(registryPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        integrations?: Array<{ slug?: string }>;
      };
      const slugs: string[] = [];
      for (const it of parsed.integrations ?? []) {
        if (typeof it.slug === "string" && it.slug.length > 0) {
          slugs.push(it.slug);
        }
      }
      cache = slugs;
    } catch {
      cache = [];
    }
    return cache;
  };
}

export function createE2eParityDriver(
  deps: E2eParityDriverDeps = {},
): ProbeDriver<E2eParityDriverInput, E2eParityAggregateSignal> {
  const launcher = deps.launcher ?? defaultLauncher;
  const attachInterceptor = deps.attachInterceptor ?? defaultAttachInterceptor;
  const serializeDom = deps.serializeDom ?? defaultSerializeDom;
  const loadReference = deps.loadReference ?? defaultLoadReference;
  const runConv = deps.runConversation ?? defaultRunConversation;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pageTimeoutMs = deps.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const referenceDir = deps.referenceDir ?? defaultReferenceDir();
  const tolerances = deps.tolerances;
  const fleetResolver = deps.fleetResolver ?? createDefaultFleetResolver();

  return {
    kind: "e2e_parity",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: E2eParityDriverInput,
    ): Promise<ProbeResult<E2eParityAggregateSignal>> {
      const observedAt = ctx.now().toISOString();
      const backendUrl = (input.backendUrl ?? input.publicUrl)!;
      const slug = deriveSlug(input.key, input.name);

      // Resolve scoping mode + targets. The driver runs against a
      // single integration per invocation; the scoping logic decides
      // whether THIS invocation's slug is the one selected for the
      // tick. Non-selected slugs return aggregate green with
      // `selectedThisTick: false` so non-target services don't flap
      // red — they're explicitly sitting out per the spec.
      let scopingMode: "weekly-rotation" | "on-demand";
      let scopingReason: string;
      let selectedThisTick: boolean;
      try {
        // Resolve the FULL fleet of D6-eligible integrations so
        // weekly-rotation can pick exactly one per week and on-demand
        // can branch on the operator-supplied target. Each driver
        // invocation runs against ONE integration; the scoping result
        // tells us whether THIS integration is the one selected for
        // the current tick.
        const fleetSlugs = await fleetResolver(ctx);
        // Defensive: the slug for this invocation MIGHT not be in the
        // fleet list (registry drift, new package not yet wired). We
        // include it so the rotation is consistent across invocations
        // for the same tick.
        const fleet = fleetSlugs.includes(slug)
          ? fleetSlugs
          : [...fleetSlugs, slug];
        const scoping = selectD6Targets(ctx.env, fleet, ctx.now());
        scopingMode = scoping.mode;
        scopingReason = scoping.reason;
        selectedThisTick = scoping.selected.includes(slug);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.e2e-parity.scoping-error", { slug, err: msg });
        return {
          key: input.key,
          state: "red",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            mode: "on-demand",
            selectedThisTick: false,
            scopingReason: "scoping resolution failed",
            total: 0,
            passed: 0,
            amber: 0,
            red: 0,
            skipped: [],
            axisFailures: 0,
            errorDesc: "scoping-error",
            failureSummary: truncateUtf8(msg, 1200),
          },
          observedAt,
        };
      }

      // Starter short-circuit. Same rule as e2e-deep — no /demos
      // routing, so D6 has nothing to compare against. Aggregate
      // green, no chromium launched.
      if (input.shape === "starter") {
        return {
          key: input.key,
          state: "green",
          signal: {
            shape: "starter",
            slug,
            backendUrl,
            mode: scopingMode,
            selectedThisTick: false,
            scopingReason: "starter: no /demos/* routing",
            total: 0,
            passed: 0,
            amber: 0,
            red: 0,
            skipped: [],
            axisFailures: 0,
            note: "starter: no /demos/* routing",
          },
          observedAt,
        };
      }

      // Not picked by the scoping logic — sit out this tick. Aggregate
      // green so the dashboard doesn't flap red on every non-target
      // slug; the `scopingReason` carries why so operators tailing
      // logs / dashboards can see the rotation cycle.
      if (!selectedThisTick) {
        return {
          key: input.key,
          state: "green",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            mode: scopingMode,
            selectedThisTick: false,
            scopingReason,
            total: 0,
            passed: 0,
            amber: 0,
            red: 0,
            skipped: [],
            axisFailures: 0,
            note: "not selected this tick (scoping)",
          },
          observedAt,
        };
      }

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
            mode: scopingMode,
            selectedThisTick: true,
            scopingReason,
            total: 0,
            passed: 0,
            amber: 0,
            red: 0,
            skipped: [],
            axisFailures: 0,
            note: "no D5 features declared",
          },
          observedAt,
        };
      }

      // Partition features into four buckets:
      //   - runnable      — script registered AND reference snapshot present
      //   - skippedScript — no script in registry (Wave 2b gap)
      //   - skippedRef    — no reference snapshot on disk
      //   - invalidRef    — reference exists but couldn't be parsed
      const runnable: D5FeatureType[] = [];
      const skippedScript: D5FeatureType[] = [];
      const skippedRef: { ft: D5FeatureType; refPath: string }[] = [];
      const invalidRef: {
        ft: D5FeatureType;
        refPath: string;
        reason: string;
      }[] = [];
      const referenceSnapshots = new Map<D5FeatureType, ParitySnapshot>();
      const referencePaths = new Map<D5FeatureType, string>();

      for (const ft of requestedFeatures) {
        if (!D5_REGISTRY.has(ft)) {
          skippedScript.push(ft);
          continue;
        }
        const refResult = await loadReference(ft, referenceDir);
        if (refResult.status === "missing") {
          skippedRef.push({ ft, refPath: refResult.snapshotPath });
          continue;
        }
        if (refResult.status === "invalid") {
          invalidRef.push({
            ft,
            refPath: refResult.snapshotPath,
            reason: refResult.reason,
          });
          continue;
        }
        runnable.push(ft);
        referenceSnapshots.set(ft, refResult.snapshot);
        referencePaths.set(ft, refResult.snapshotPath);
      }

      // Emit skip rows up-front. These are independent of chromium
      // launch outcomes — the dashboard sees a definite per-cell
      // verdict whether or not the runnable features even start.
      for (const ft of skippedScript) {
        await sideEmit(ctx, {
          key: `d6:${slug}/${ft}`,
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
      for (const { ft, refPath } of skippedRef) {
        await sideEmit(ctx, {
          key: `d6:${slug}/${ft}`,
          state: "green",
          signal: {
            slug,
            featureType: ft,
            backendUrl,
            referencePath: refPath,
            note: "no reference snapshot",
          },
          observedAt: ctx.now().toISOString(),
        });
      }
      for (const { ft, refPath, reason } of invalidRef) {
        await sideEmit(ctx, {
          key: `d6:${slug}/${ft}`,
          state: "red",
          signal: {
            slug,
            featureType: ft,
            backendUrl,
            referencePath: refPath,
            errorClass: "invalid-reference",
            errorDesc: reason,
          },
          observedAt: ctx.now().toISOString(),
        });
      }

      const skipped = [...skippedScript, ...skippedRef.map((s) => s.ft)];

      // Nothing runnable + nothing failed-on-load → aggregate green.
      // (Invalid ref is still aggregate-red because the reference is
      // corrupt — operators must fix that before parity verdicts mean
      // anything for that featureType.)
      if (runnable.length === 0) {
        const aggregateState: "green" | "red" =
          invalidRef.length === 0 ? "green" : "red";
        return {
          key: input.key,
          state: aggregateState,
          signal: {
            shape: "package",
            slug,
            backendUrl,
            mode: scopingMode,
            selectedThisTick: true,
            scopingReason,
            total: requestedFeatures.length,
            passed: 0,
            amber: 0,
            red: invalidRef.length,
            skipped,
            axisFailures: 0,
            note:
              invalidRef.length > 0
                ? `${invalidRef.length} reference snapshot(s) invalid`
                : "no runnable features (all skipped)",
          },
          observedAt,
        };
      }

      // Hard-timeout + abort plumbing. Mirrors e2e-deep / e2e-demos so
      // operators see a consistent abort/timeout signal across drivers.
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

      let browser: E2eParityBrowser | undefined;
      let passed = 0;
      let amber = 0;
      let red = invalidRef.length;
      let axisFailures = 0;

      try {
        try {
          browser = await launcher();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn("probe.e2e-parity.launcher-error", {
            slug,
            err: msg,
          });
          return {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              mode: scopingMode,
              selectedThisTick: true,
              scopingReason,
              total: requestedFeatures.length,
              passed: 0,
              amber: 0,
              red: red + runnable.length,
              skipped,
              axisFailures: 0,
              errorDesc: "launcher-error",
              failureSummary: truncateUtf8(msg, 1200),
            },
            observedAt,
          };
        }

        for (const ft of runnable) {
          const sideKey = `d6:${slug}/${ft}`;
          const script = D5_REGISTRY.get(ft)!;
          const reference = referenceSnapshots.get(ft)!;
          const refPath = referencePaths.get(ft);
          const route = (script.preNavigateRoute ?? defaultRoute)(ft);
          const url = `${backendUrl}${route}`;

          if (abort.signal.aborted) {
            red += 1;
            await sideEmit(ctx, {
              key: sideKey,
              state: "red",
              signal: {
                slug,
                featureType: ft,
                backendUrl,
                url,
                fixtureFile: script.fixtureFile,
                referencePath: refPath,
                errorClass: "abort",
                errorDesc: timedOut
                  ? `timeout after ${timeoutMs}ms`
                  : "aborted",
              },
              observedAt: ctx.now().toISOString(),
            });
            continue;
          }

          const featureResult = await runFeatureCapture({
            browser,
            url,
            pageTimeoutMs,
            script,
            buildCtx: {
              integrationSlug: slug,
              featureType: ft,
              baseUrl: backendUrl,
            },
            attachInterceptor,
            serializeDom,
            runConversation: runConv,
            abortSignal: abort.signal,
          });

          if (!featureResult.ok) {
            red += 1;
            await sideEmit(ctx, {
              key: sideKey,
              state: "red",
              signal: {
                slug,
                featureType: ft,
                backendUrl,
                url,
                fixtureFile: script.fixtureFile,
                referencePath: refPath,
                errorClass: featureResult.errorClass,
                errorDesc: featureResult.errorDesc,
              },
              observedAt: ctx.now().toISOString(),
            });
            continue;
          }

          const report = compareParity(
            reference,
            featureResult.captured,
            tolerances,
          );
          axisFailures += report.failure_count;
          const severity = severityFromFailureCount(report.failure_count);
          let state: "green" | "red" | "degraded";
          if (severity === "green") {
            state = "green";
            passed += 1;
          } else if (severity === "amber") {
            state = "degraded";
            amber += 1;
          } else {
            state = "red";
            red += 1;
          }

          await sideEmit(ctx, {
            key: sideKey,
            state,
            signal: {
              slug,
              featureType: ft,
              backendUrl,
              url,
              fixtureFile: script.fixtureFile,
              referencePath: refPath,
              severity,
              axes: report.axes,
              axisFailures: report.failure_count,
              details: report.details,
            },
            observedAt: ctx.now().toISOString(),
          });
        }

        // Aggregate state: red when any feature is red OR amber, green
        // only when all runnable features passed cleanly. Amber on a
        // per-feature row counts as a partial regression for the
        // aggregate — dashboards / Slack still get a single
        // distinguishable signal at the top level. (We could add an
        // aggregate "degraded" here but the State enum already has it
        // and the alert engine routes degraded rows independently.)
        let aggregateState: "green" | "red" | "degraded";
        if (red > 0) aggregateState = "red";
        else if (amber > 0) aggregateState = "degraded";
        else aggregateState = "green";

        return {
          key: input.key,
          state: aggregateState,
          signal: {
            shape: "package",
            slug,
            backendUrl,
            mode: scopingMode,
            selectedThisTick: true,
            scopingReason,
            total: requestedFeatures.length,
            passed,
            amber,
            red,
            skipped,
            axisFailures,
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
            ctx.logger.warn("probe.e2e-parity.browser-close-failed", {
              slug,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },
  };
}

/* ─── Per-feature capture ─────────────────────────────────────────── */

interface FeatureCaptureOpts {
  browser: E2eParityBrowser;
  url: string;
  pageTimeoutMs: number;
  script: D5Script;
  buildCtx: D5BuildContext;
  attachInterceptor: E2eParityAttachInterceptor;
  serializeDom: E2eParitySerializeDom;
  runConversation: E2eParityRunConversation;
  abortSignal: AbortSignal;
}

type FeatureCaptureResult =
  | { ok: true; captured: ParitySnapshot }
  | { ok: false; errorClass: string; errorDesc: string };

/**
 * Per-feature run: open a fresh context, navigate, run the conversation
 * with PER-TURN SSE interceptor attach/detach (B10's interceptor only
 * captures the FIRST matching request per attach — see B12's
 * reference-capture for the same pattern), serialize the DOM, build a
 * `ParitySnapshot`, return.
 *
 * Fresh context per feature so cookies / localStorage from one feature
 * can't leak into the next. Context closes in `finally` so a hung
 * conversation doesn't orphan resources.
 */
async function runFeatureCapture(
  opts: FeatureCaptureOpts,
): Promise<FeatureCaptureResult> {
  const {
    browser,
    url,
    pageTimeoutMs,
    script,
    buildCtx,
    attachInterceptor,
    serializeDom,
    runConversation: runConv,
    abortSignal,
  } = opts;

  if (abortSignal.aborted) {
    return {
      ok: false,
      errorClass: "abort",
      errorDesc: "aborted before start",
    };
  }

  let context: E2eParityBrowserContext | undefined;
  let page: E2eParityPage | undefined;
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

    const turns = script.buildTurns(buildCtx);
    if (turns.length === 0) {
      return {
        ok: false,
        errorClass: "script-error",
        errorDesc: "script produced zero turns",
      };
    }

    // Per-turn interceptor attach/stop. B10's interceptor is single-
    // stream-per-attach, so multi-turn conversations need a fresh
    // attach for each turn. B12 already lives this pattern in
    // reference-capture; we mirror it here so D6 captures match the
    // reference-capture flow shape exactly (any drift between the two
    // would invalidate the comparison).
    const perTurnCaptures: SseCapture[] = [];
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i]!;
      let interceptor: SseInterceptorHandle;
      try {
        interceptor = await attachInterceptor(page);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          errorClass: "interceptor-attach-error",
          errorDesc: truncateUtf8(`turn ${i + 1}: ${msg}`, 1200),
        };
      }

      const turnResult = await runConv(page, [turn]);

      let capture: SseCapture;
      try {
        capture = await interceptor.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          errorClass: "interceptor-stop-error",
          errorDesc: truncateUtf8(`turn ${i + 1}: ${msg}`, 1200),
        };
      }
      perTurnCaptures.push(capture);

      if (turnResult.failure_turn !== undefined) {
        return {
          ok: false,
          errorClass: "conversation-error",
          errorDesc: truncateUtf8(
            turnResult.error ?? "conversation failed without error message",
            1200,
          ),
        };
      }
    }

    let domElements: ParitySnapshot["domElements"];
    try {
      domElements = await serializeDom(page);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        errorClass: "dom-serialize-error",
        errorDesc: truncateUtf8(msg, 1200),
      };
    }

    const captured = buildSnapshot(perTurnCaptures, domElements);
    return { ok: true, captured };
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

/* ─── State mapping helpers ───────────────────────────────────────── */

/**
 * Spec-mandated 3-state severity map:
 *   - 0 axis failures → green (perfect parity).
 *   - 1-2 axis failures → amber (degraded but recognizable).
 *   - 3-4 axis failures → red (catastrophic divergence).
 *
 * Driver maps amber → ProbeState `degraded` because the State enum has
 * no native amber slot; the per-row signal carries the original label
 * for humans.
 */
function severityFromFailureCount(n: number): "green" | "amber" | "red" {
  if (n === 0) return "green";
  if (n <= 2) return "amber";
  return "red";
}

async function sideEmit(
  ctx: ProbeContext,
  result: ProbeResult<E2eParityFeatureSignal>,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.e2e-parity.writer-missing", { key: result.key });
    return;
  }
  try {
    await ctx.writer.write(result);
  } catch (err) {
    ctx.logger.error("probe.e2e-parity.side-emit-writer-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

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

/**
 * Default-tolerances re-export — callers (CLI / tests) that want to
 * override only one knob can spread this onto their override without
 * redeclaring the unchanged fields.
 */
export { DEFAULT_PARITY_TOLERANCES };

/** Default driver instance — registered by the orchestrator at boot. */
export const e2eParityDriver = createE2eParityDriver();
