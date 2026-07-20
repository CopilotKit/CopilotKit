import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Regression guard for the `redeploy-staging` job in
// `.github/workflows/showcase_build.yml`.
//
// The bug: the job's `if:` guarded on `needs.build.result != 'cancelled'`.
// GitHub Actions rolls a matrix job's aggregate `result` up to `cancelled`
// whenever ANY single leg is cancelled — even if 27/28 legs succeeded. A
// single leg cancelled by runner contention (NOT a run-level cancellation)
// therefore skipped the staging redeploy for the ENTIRE fleet, even though
// the downstream "Compute changed-service list" step correctly intersects the
// build matrix with the actual per-slot successes.
//
// The correct signal for "should we redeploy?" is
// `aggregate-build-results.outputs.any_success == 'true'` (computed from the
// real per-slot build-result artifacts), exactly as the sibling
// `aggregate-build-results` job already gates itself. This test encodes the
// LIVE guard string from the workflow and evaluates it against a faithful
// model of GitHub Actions' matrix→job result rollup.
// ---------------------------------------------------------------------------

const WORKFLOW_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".github",
  "workflows",
  "showcase_build.yml",
);

/** Read the LIVE `if:` expression of the given job from the workflow YAML. */
function readJobGuard(jobId: string): string {
  const doc = parseYaml(readFileSync(WORKFLOW_PATH, "utf8")) as {
    jobs: Record<string, { if?: string }>;
  };
  const job = doc.jobs[jobId];
  if (!job) throw new Error(`Job '${jobId}' not found in ${WORKFLOW_PATH}`);
  if (typeof job.if !== "string") {
    throw new Error(`Job '${jobId}' has no string 'if:' guard`);
  }
  return job.if;
}

// ---------------------------------------------------------------------------
// A faithful (bounded-grammar) evaluator for the GitHub Actions `if:`
// expressions this workflow uses: top-level `&&` chains of either a status
// function (`cancelled()`/`always()`/`success()`/`failure()`, optionally
// negated with `!`) or a `<context.path> ==|!= '<literal>'` comparison.
// Context paths may contain hyphens (e.g. `needs.detect-changes.outputs.*`),
// so we resolve them by splitting on `.` rather than relying on JS property
// access.
// ---------------------------------------------------------------------------

interface GhContext {
  needs: Record<string, unknown>;
  /** Whether the WORKFLOW RUN was cancelled (drives `cancelled()`). */
  runCancelled: boolean;
}

function resolvePath(path: string, ctx: GhContext): string {
  const segs = path.split(".");
  let cur: unknown = { needs: ctx.needs };
  for (const seg of segs) {
    if (cur == null || typeof cur !== "object" || !(seg in (cur as object))) {
      throw new Error(`Unresolved context path '${path}' at segment '${seg}'`);
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return String(cur);
}

function evalClause(raw: string, ctx: GhContext): boolean {
  const clause = raw.trim();

  const fn = clause.match(/^(!)?\s*(cancelled|always|success|failure)\(\)$/);
  if (fn) {
    const negated = fn[1] === "!";
    let value: boolean;
    switch (fn[2]) {
      case "cancelled":
        value = ctx.runCancelled;
        break;
      case "always":
        value = true;
        break;
      case "success":
        value = !ctx.runCancelled;
        break;
      case "failure":
        value = false;
        break;
      default:
        throw new Error(`Unhandled status function '${fn[2]}'`);
    }
    return negated ? !value : value;
  }

  const cmp = clause.match(/^(.+?)\s*(==|!=)\s*'([^']*)'$/);
  if (cmp) {
    const left = resolvePath(cmp[1].trim(), ctx);
    const right = cmp[3];
    return cmp[2] === "==" ? left === right : left !== right;
  }

  throw new Error(`Unparseable clause: '${clause}'`);
}

function evalGuard(expr: string, ctx: GhContext): boolean {
  const inner = expr
    .replace(/^\s*\$\{\{/, "")
    .replace(/\}\}\s*$/, "")
    .trim();
  // No `||` and no `&&` nested inside parens in this grammar, so a top-level
  // split on `&&` is sound.
  return inner.split("&&").every((c) => evalClause(c, ctx));
}

// ---------------------------------------------------------------------------
// Faithful model of GitHub Actions' matrix → job `result` rollup.
//   - any leg cancelled              => 'cancelled'
//   - else any leg failed            => 'failure'
//   - else (all success/skipped)     => 'success'
// ---------------------------------------------------------------------------
function rollupBuildResult(legResults: readonly string[]): string {
  if (legResults.includes("cancelled")) return "cancelled";
  if (legResults.includes("failure")) return "failure";
  return "success";
}

/**
 * Build a GH context for the `redeploy-staging` guard from a set of per-leg
 * build outcomes. `any_success` is derived from the real per-slot outcomes
 * exactly as `aggregate-build-results` does (any leg == 'success').
 * `runCancelled` models a RUN-level cancellation, which a single contention-
 * cancelled leg does NOT trigger.
 */
function contextFor(
  legResults: readonly string[],
  opts: { runCancelled?: boolean; hasChanges?: boolean } = {},
): GhContext {
  const anySuccess = legResults.includes("success");
  return {
    runCancelled: opts.runCancelled ?? false,
    needs: {
      "detect-changes": {
        outputs: { has_changes: String(opts.hasChanges ?? true) },
      },
      build: { result: rollupBuildResult(legResults) },
      "aggregate-build-results": {
        outputs: { any_success: String(anySuccess) },
      },
    },
  };
}

/**
 * Model the FULL GH job-dispatch decision, not just the boolean expression:
 * a dependent job is auto-SKIPPED when a `needs` job did not succeed, UNLESS
 * the `if:` contains a status-check function (`always`/`cancelled`/`success`/
 * `failure`). Both the buggy and fixed guards here contain `!cancelled()`, so
 * the expression is always evaluated — but we model the override rule anyway
 * so the test stays honest if the guard ever drops its status function.
 */
function jobRuns(
  guard: string,
  ctx: GhContext,
  buildJobKey = "build",
): boolean {
  const hasStatusFn = /\b(always|cancelled|success|failure)\(\)/.test(guard);
  const buildResult = String(
    (ctx.needs[buildJobKey] as { result: string }).result,
  );
  const depFailedOrCancelled =
    buildResult === "failure" || buildResult === "cancelled";
  if (depFailedOrCancelled && !hasStatusFn) return false;
  return evalGuard(guard, ctx);
}

/**
 * Build a GH context for the `redeploy-staging-starters` guard. Unlike the
 * showcase job, the starter lane has NO aggregate `any_success` output: its
 * job guard only sees `detect-starter-changes.has_changes` and
 * `build-starters.result`. The zero-success safety lives DOWNSTREAM, at the
 * redeploy step's `if: steps.changed.outputs.services != ''` guard (see
 * `starterRedeployStepRuns`).
 */
function starterContextFor(
  legResults: readonly string[],
  opts: { runCancelled?: boolean; hasChanges?: boolean } = {},
): GhContext {
  return {
    runCancelled: opts.runCancelled ?? false,
    needs: {
      "detect-starter-changes": {
        outputs: { has_changes: String(opts.hasChanges ?? true) },
      },
      "build-starters": { result: rollupBuildResult(legResults) },
    },
  };
}

/**
 * Model the starter redeploy STEP guard (`steps.changed.outputs.services !=
 * ''`). The compute step intersects the starter matrix with the per-slot
 * SUCCESS set, so the services CSV is non-empty iff at least one starter leg
 * actually built. This is the starter lane's "no deploy on a dead build"
 * guarantee — equivalent to the showcase lane's `any_success` job guard, just
 * enforced one level down.
 */
function starterRedeployStepRuns(legResults: readonly string[]): boolean {
  return legResults.includes("success");
}

describe("redeploy-staging guard — matrix cancellation regression", () => {
  const guard = readJobGuard("redeploy-staging");

  it("(a) redeploys when 27 legs succeed and 1 leg is cancelled (contention)", () => {
    const legs = [...Array(27).fill("success"), "cancelled"];
    // A single leg cancelled by runner contention does NOT cancel the run.
    const ctx = contextFor(legs, { runCancelled: false });
    expect(rollupBuildResult(legs)).toBe("cancelled"); // GH rolls up to cancelled
    expect(jobRuns(guard, ctx)).toBe(true); // ...but the fleet still redeploys
  });

  it("(b) redeploys when all legs succeed", () => {
    const legs = Array(28).fill("success");
    expect(jobRuns(guard, contextFor(legs))).toBe(true);
  });

  it("(c) skips when the build is genuinely dead (zero successes)", () => {
    const legs = Array(28).fill("failure");
    expect(jobRuns(guard, contextFor(legs))).toBe(false);
  });

  it("skips a partial-success run only when the whole RUN is cancelled", () => {
    const legs = [...Array(27).fill("success"), "cancelled"];
    const ctx = contextFor(legs, { runCancelled: true });
    expect(jobRuns(guard, ctx)).toBe(false);
  });

  it("skips when detect-changes reports no changes", () => {
    const legs = Array(28).fill("success");
    expect(jobRuns(guard, contextFor(legs, { hasChanges: false }))).toBe(false);
  });
});

describe("redeploy-staging-starters guard — matrix cancellation regression", () => {
  const guard = readJobGuard("redeploy-staging-starters");
  const runStarters = (ctx: GhContext) => jobRuns(guard, ctx, "build-starters");

  it("(a) runs (and redeploys) when 1 starter leg is cancelled and the rest succeed", () => {
    const legs = [...Array(5).fill("success"), "cancelled"];
    const ctx = starterContextFor(legs, { runCancelled: false });
    expect(rollupBuildResult(legs)).toBe("cancelled"); // GH rolls up to cancelled
    expect(runStarters(ctx)).toBe(true); // ...but the starter lane still runs
    expect(starterRedeployStepRuns(legs)).toBe(true); // non-empty services CSV
  });

  it("(b) runs (and redeploys) when all starter legs succeed", () => {
    const legs = Array(6).fill("success");
    expect(runStarters(starterContextFor(legs))).toBe(true);
    expect(starterRedeployStepRuns(legs)).toBe(true);
  });

  it("(c) the job may run on a zero-success build, but the redeploy step is a no-op (empty CSV)", () => {
    for (const dead of [Array(6).fill("failure"), Array(6).fill("cancelled")]) {
      // The zero-success safety is at the STEP level, not the job guard: the
      // services CSV is empty, so `if: steps.changed.outputs.services != ''`
      // skips the redeploy — nothing is deployed on a dead build.
      expect(starterRedeployStepRuns(dead)).toBe(false);
    }
  });

  it("skips when the whole RUN is cancelled", () => {
    const legs = [...Array(5).fill("success"), "cancelled"];
    const ctx = starterContextFor(legs, { runCancelled: true });
    expect(runStarters(ctx)).toBe(false);
  });

  it("skips when detect-starter-changes reports no changes", () => {
    const legs = Array(6).fill("success");
    expect(runStarters(starterContextFor(legs, { hasChanges: false }))).toBe(
      false,
    );
  });
});
