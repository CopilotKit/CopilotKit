import { z } from "zod";
import { promises as fs } from "node:fs";
import { truncateUtf8 } from "../../render/filters.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Driver wrapper around the e2e-smoke probe. The legacy probe at
 * `../e2e-smoke.ts` accepts an injected `runSuite()` callback so Phase 4.1
 * can delete it cleanly — the driver here replaces that indirection with
 * Playwright-in-process: launch chromium via the `playwright` package, run
 * a named suite, then parse the Playwright JSON reporter output and project
 * it onto the existing `E2ESmokeSignal` shape so alert-rule templates don't
 * churn.
 *
 * Why in-process instead of `spawn`:
 *   - The showcase-ops container already runs as a long-lived Node process;
 *     we get tighter lifecycle control (AbortSignal-driven teardown) than
 *     child_process would give us.
 *   - Reporter JSON is written to a deterministic path the driver picks,
 *     so we don't have to scrape stdout — the runner's contract is just
 *     "here's the path to the reporter.json after the run finishes."
 *
 * The runner itself is dependency-injected via `PlaywrightRunner`. Tests
 * substitute a fake that points at a pre-baked reporter JSON fixture so
 * unit tests never touch real chromium. Production callers get the default
 * runner from `defaultPlaywrightRunner` which does the real `chromium.launch()`.
 */

const inputSchema = z.object({
  key: z.string().min(1),
  suite: z.enum(["l1-3", "l4"]).optional(),
});

type E2eSmokeDriverInput = z.infer<typeof inputSchema>;

/** Signal shape — must stay in sync with `../e2e-smoke.ts#E2eSmokeSignal`
 * until Phase 4.1 deletes the legacy probe. Keeping `failureSummary` and
 * `suite` means existing alert templates (`config/alerts/e2e-smoke-failure.yml`)
 * render identically regardless of which path produced the tick. `errorDesc`
 * is additive — legacy templates ignore it, new templates can key on it
 * when the driver itself errored (timeout, parse failure, runner crash). */
export interface E2eSmokeSignal {
  suite: string;
  failureSummary: string;
  errorDesc?: string;
}

/**
 * Pluggable Playwright runner. The production implementation launches
 * chromium and points the JSON reporter at a scratch path; tests swap
 * this out for a fake that points at a pre-baked fixture. The `signal`
 * parameter is how the driver kills a runaway run: the driver arms an
 * AbortController on its own timeout, and the runner MUST abort its
 * internal Playwright invocation when `signal.aborted` flips true.
 */
export type PlaywrightRunner = (
  opts: { suite: "l1-3" | "l4" },
  signal: AbortSignal,
) => Promise<{ reporterJsonPath: string }>;

export interface E2eSmokeDriverDeps {
  /** Playwright runner. Defaults to the real chromium launcher. */
  runner?: PlaywrightRunner;
  /** Driver-level hard timeout. Defaults to 10 minutes. The probe-invoker
   * layer also enforces `timeout_ms` from the YAML, but the driver-side
   * timeout is what kills the Playwright process itself — the invoker
   * layer only races the promise and leaves the inner worker orphaned. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Minimal shape of the Playwright JSON reporter we care about. The real
 * reporter emits far more fields; we only consume `stats.unexpected` and
 * per-spec `error.message` / `error.stack` for the failure summary. See
 * Playwright's reporter docs for the full schema — we stay narrow on
 * purpose so an upstream change that adds fields doesn't break parsing.
 */
interface PlaywrightReporterResult {
  error?: { message?: string; stack?: string };
  errors?: { message?: string; stack?: string }[];
  status?: string;
}
interface PlaywrightReporterTest {
  results?: PlaywrightReporterResult[];
}
interface PlaywrightReporterSpec {
  title?: string;
  ok?: boolean;
  tests?: PlaywrightReporterTest[];
}
interface PlaywrightReporterSuite {
  title?: string;
  specs?: PlaywrightReporterSpec[];
  suites?: PlaywrightReporterSuite[];
}
interface PlaywrightReporterJson {
  stats?: { unexpected?: number; expected?: number };
  suites?: PlaywrightReporterSuite[];
}

/**
 * Default Playwright runner. Dynamically imports `playwright` so the driver
 * module can load in environments without chromium installed (unit tests,
 * schema-only linting). The import is lazy — it only runs when the driver
 * is actually invoked in production.
 *
 * The runner's job is:
 *   1. Launch chromium via `playwright.chromium.launch()`.
 *   2. Run a minimal smoke suite for the named level. For now the default
 *      runner points at the same suite matrix the legacy GH-Action smoke
 *      workflow used; Phase 4.1 will replace the inline invocation with
 *      a spawn of `@playwright/test` against the showcase-starter tests.
 *   3. Write a JSON reporter to a scratch path and return the path.
 *
 * A missing `playwright` package at runtime surfaces as a thrown Error
 * the driver converts into a red ProbeResult with `errorDesc: "runner-error"`.
 * That way a misconfigured container (Dockerfile didn't install chromium)
 * produces a keyed alert on the next tick instead of a silent no-op.
 *
 * Declared before `createE2eSmokeDriver` so the `const` default-fallback
 * reference is initialised at call time. Keep the definition here (not
 * at module-end) — TDZ otherwise.
 */
const defaultPlaywrightRunner: PlaywrightRunner = async (
  _opts,
  _signal,
): Promise<{ reporterJsonPath: string }> => {
  // NOTE: the in-process runner is implemented incrementally. Until the
  // smoke-suite harness lands (Phase 4.1 companion), the default runner
  // throws — operators haven't yet switched the probe scheduler to emit
  // this driver, so the throw is unreachable in production. The explicit
  // throw keeps the default path typed and behavioral rather than a
  // silent stub that would green-by-default.
  throw new Error(
    "playwright runner not yet wired — inject a runner via createE2eSmokeDriver({ runner })",
  );
};

/** Create a configured e2e-smoke driver. Exported for tests so they can
 * inject a fake runner and a tight timeout; production callers use the
 * module-level `e2eSmokeDriver` which defaults both. */
export function createE2eSmokeDriver(
  deps: E2eSmokeDriverDeps = {},
): ProbeDriver<E2eSmokeDriverInput, E2eSmokeSignal> {
  const runner = deps.runner ?? defaultPlaywrightRunner;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    kind: "e2e_smoke",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: E2eSmokeDriverInput,
    ): Promise<ProbeResult<E2eSmokeSignal>> {
      const suite = input.suite ?? "l1-3";
      const observedAt = ctx.now().toISOString();

      // Arm the AbortController before the runner call so the runner sees
      // an already-cancellable signal. `timeoutHandle` fires the abort if
      // the runner doesn't resolve in time — we race `runner()` against
      // the timeout so the method returns deterministically even if the
      // runner ignores the signal.
      const abort = new AbortController();
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, timeoutMs);

      let reporterJsonPath: string;
      try {
        const result = await runner({ suite }, abort.signal);
        reporterJsonPath = result.reporterJsonPath;
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          ctx.logger.warn("probe.e2e-smoke.timeout", {
            suite,
            timeoutMs,
          });
          return {
            key: input.key,
            state: "red",
            signal: {
              suite,
              failureSummary: `timeout after ${timeoutMs}ms`,
              errorDesc: "timeout",
            },
            observedAt,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.e2e-smoke.runner-error", {
          suite,
          err: msg,
        });
        return {
          key: input.key,
          state: "red",
          signal: {
            suite,
            failureSummary: truncateUtf8(msg, 1200),
            errorDesc: "runner-error",
          },
          observedAt,
        };
      }
      clearTimeout(timeoutHandle);

      // Parse reporter JSON. A malformed / missing reporter file is a
      // probe-level error: Playwright ran to completion but produced
      // unparseable output, which is indistinguishable from a silent
      // reporter crash. Fail loud rather than return green-by-default.
      let raw: string;
      try {
        raw = await fs.readFile(reporterJsonPath, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.e2e-smoke.reporter-read-failed", {
          suite,
          path: reporterJsonPath,
          err: msg,
        });
        return {
          key: input.key,
          state: "red",
          signal: {
            suite,
            failureSummary: truncateUtf8(`reporter read failed: ${msg}`, 1200),
            errorDesc: "reporter-missing",
          },
          observedAt,
        };
      }

      let parsed: PlaywrightReporterJson;
      try {
        parsed = JSON.parse(raw) as PlaywrightReporterJson;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.e2e-smoke.reporter-parse-failed", {
          suite,
          err: msg,
        });
        return {
          key: input.key,
          state: "red",
          signal: {
            suite,
            failureSummary: truncateUtf8(`reporter parse failed: ${msg}`, 1200),
            errorDesc: "reporter-parse-failed",
          },
          observedAt,
        };
      }

      const unexpected = parsed.stats?.unexpected ?? 0;
      if (unexpected === 0) {
        return {
          key: input.key,
          state: "green",
          signal: { suite, failureSummary: "" },
          observedAt,
        };
      }

      // Walk the suite tree and collect the first failure's message +
      // stack. We don't aggregate all failures — the 1200-byte budget is
      // too small to meaningfully include N failures, and the alert
      // template already links to the full run URL. First-failure gives
      // operators enough context to recognise the regression class.
      const failureLines = collectFailureLines(parsed);
      const summary = failureLines.length
        ? truncateUtf8(failureLines.slice(0, 15).join("\n"), 1200)
        : `${unexpected} test(s) failed (no error detail in reporter)`;
      return {
        key: input.key,
        state: "red",
        signal: { suite, failureSummary: summary },
        observedAt,
      };
    },
  };
}

/** Default driver instance with the real Playwright runner. Registered by
 * the orchestrator at boot. */
export const e2eSmokeDriver = createE2eSmokeDriver();

function collectFailureLines(parsed: PlaywrightReporterJson): string[] {
  const out: string[] = [];
  const walk = (suites: PlaywrightReporterSuite[] | undefined): void => {
    if (!suites) return;
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        if (spec.ok === false) {
          const test = spec.tests?.[0];
          const result = test?.results?.find(
            (r) => r.status && r.status !== "passed",
          );
          if (result) {
            const err = result.error ?? result.errors?.[0];
            if (err?.message) out.push(err.message);
            if (err?.stack) {
              // Split stack on newline so `slice(0, 15)` trims to the
              // first 15 lines rather than the first 15 error entries.
              const stackLines = err.stack.split("\n");
              out.push(...stackLines);
            }
          }
          if (out.length > 0) return; // first-failure only
        }
      }
      walk(suite.suites);
      if (out.length > 0) return;
    }
  };
  walk(parsed.suites);
  return out;
}
