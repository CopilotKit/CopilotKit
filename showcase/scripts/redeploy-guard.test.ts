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

interface WorkflowStep {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface WorkflowJob {
  if?: string;
  needs?: string[] | string;
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
}

function readWorkflow(): { jobs: Record<string, WorkflowJob> } {
  return parseYaml(readFileSync(WORKFLOW_PATH, "utf8"));
}

/** Read the LIVE `if:` expression of the given job from the workflow YAML. */
function readJobGuard(jobId: string): string {
  const job = readWorkflow().jobs[jobId];
  if (!job) throw new Error(`Job '${jobId}' not found in ${WORKFLOW_PATH}`);
  if (typeof job.if !== "string") {
    throw new Error(`Job '${jobId}' has no string 'if:' guard`);
  }
  return job.if;
}

/** Read the LIVE `run:` script of a named step of a named job. */
function readStepScript(jobId: string, stepName: string): string {
  const job = readWorkflow().jobs[jobId];
  if (!job) throw new Error(`Job '${jobId}' not found in ${WORKFLOW_PATH}`);
  const step = (job.steps ?? []).find((s) => s.name === stepName);
  if (!step) {
    throw new Error(`Step '${stepName}' not found in job '${jobId}'`);
  }
  if (typeof step.run !== "string") {
    throw new Error(
      `Step '${stepName}' of job '${jobId}' has no 'run:' script`,
    );
  }
  return step.run;
}

/**
 * Parse the LIVE `case "$BUILD_STATUS" in ... esac` block out of a per-slot
 * result-writer step and return the function it implements:
 * `job.status` → the `status` value recorded in the per-slot result artifact.
 *
 * This reads the REAL shell out of the REAL workflow rather than restating it,
 * so deleting or altering an arm changes what these tests observe. That is the
 * whole point: the per-slot artifact is the ONLY place a leg-level
 * cancellation survives (GitHub's status functions are blind to it), so the
 * mapping this `case` implements IS the alerting capability under test.
 */
function readSlotStatusMapper(
  jobId: string,
  stepName: string,
): (jobStatus: string) => string {
  const script = readStepScript(jobId, stepName);
  const block = script.match(
    /case\s+"\$BUILD_STATUS"\s+in\s*\n([\s\S]*?)\n\s*esac/,
  );
  if (!block) {
    throw new Error(
      `No 'case "$BUILD_STATUS" in ... esac' block in step '${stepName}' of job '${jobId}'`,
    );
  }
  const arms: { patterns: string[]; status: string }[] = [];
  const armRe = /^\s*([^)\n]+?)\)\s*STATUS=(\S+)\s*;;\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = armRe.exec(block[1])) !== null) {
    arms.push({
      patterns: m[1].split("|").map((p) => p.trim()),
      status: m[2],
    });
  }
  if (arms.length === 0) {
    throw new Error(
      `Parsed zero case arms in step '${stepName}' of job '${jobId}' — the parser has drifted from the YAML`,
    );
  }
  return (jobStatus: string) => {
    for (const arm of arms) {
      // `*` is the only glob these arms use; everything else is a literal.
      if (arm.patterns.some((p) => p === "*" || p === jobStatus)) {
        return arm.status;
      }
    }
    throw new Error(`No case arm matched job.status='${jobStatus}'`);
  };
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

/**
 * Model GitHub's `failure()` status function: true when at least one job in
 * `needs` resolved to `'failure'` (and the run itself was not cancelled). A
 * matrix rollup of `'cancelled'` is NOT a failure — that is the exact blind
 * spot the `notify` job's bare `failure()` guard missed.
 */
function anyDepFailed(ctx: GhContext): boolean {
  return Object.values(ctx.needs).some(
    (j) => (j as { result?: string } | undefined)?.result === "failure",
  );
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
        value = !ctx.runCancelled && anyDepFailed(ctx);
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

// ---------------------------------------------------------------------------
// A small recursive-descent evaluator for the boolean grammar these guards
// use: `||` / `&&` / `!` / parentheses over atoms, where each atom is a status
// function or a `<path> ==|!= '<literal>'` comparison (handled by evalClause).
// `&&` binds tighter than `||`, matching GitHub Actions' operator precedence.
// The `notify` job's guard combines `failure()` with an `any_success` check via
// `||` inside parens, which the previous split-on-`&&` model could not parse.
// ---------------------------------------------------------------------------
type Token = { kind: "&&" | "||" | "!" | "(" | ")" | "atom"; text?: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const atomRe =
    /^(?:(?:!\s*)?(?:cancelled|always|success|failure)\(\)|[A-Za-z0-9_.-]+\s*(?:==|!=)\s*'[^']*')/;
  while (i < expr.length) {
    const rest = expr.slice(i);
    const ws = rest.match(/^\s+/);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    if (rest.startsWith("&&")) {
      tokens.push({ kind: "&&" });
      i += 2;
      continue;
    }
    if (rest.startsWith("||")) {
      tokens.push({ kind: "||" });
      i += 2;
      continue;
    }
    if (rest[0] === "(") {
      tokens.push({ kind: "(" });
      i += 1;
      continue;
    }
    if (rest[0] === ")") {
      tokens.push({ kind: ")" });
      i += 1;
      continue;
    }
    const atom = rest.match(atomRe);
    if (atom) {
      tokens.push({ kind: "atom", text: atom[0] });
      i += atom[0].length;
      continue;
    }
    if (rest[0] === "!") {
      // A bare `!` here can only be negation of a parenthesized group; a `!`
      // that prefixes a status function is already consumed by the atom regex.
      tokens.push({ kind: "!" });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected token at: '${rest}'`);
  }
  return tokens;
}

function evalGuard(expr: string, ctx: GhContext): boolean {
  const inner = expr
    .replace(/^\s*\$\{\{/, "")
    .replace(/\}\}\s*$/, "")
    .trim();
  const tokens = tokenize(inner);
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (kind: Token["kind"]) => {
    const t = tokens[pos];
    if (!t || t.kind !== kind) {
      throw new Error(`Expected '${kind}' at token ${pos}`);
    }
    pos += 1;
    return t;
  };

  const parsePrimary = (): boolean => {
    const t = peek();
    if (!t) throw new Error("Unexpected end of guard expression");
    if (t.kind === "!") {
      eat("!");
      return !parsePrimary();
    }
    if (t.kind === "(") {
      eat("(");
      const v = parseOr();
      eat(")");
      return v;
    }
    if (t.kind === "atom") {
      eat("atom");
      return evalClause(t.text as string, ctx);
    }
    throw new Error(`Unexpected token '${t.kind}' in guard expression`);
  };

  function parseAnd(): boolean {
    let v = parsePrimary();
    while (peek()?.kind === "&&") {
      eat("&&");
      const rhs = parsePrimary();
      v = v && rhs;
    }
    return v;
  }

  function parseOr(): boolean {
    let v = parseAnd();
    while (peek()?.kind === "||") {
      eat("||");
      const rhs = parseAnd();
      v = v || rhs;
    }
    return v;
  }

  const result = parseOr();
  if (pos !== tokens.length) {
    throw new Error(`Trailing tokens in guard expression at ${pos}`);
  }
  return result;
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
  // `any_cancelled` / `cancelled_services` are derived from the per-slot
  // outcomes exactly as `aggregate-build-results` does.
  //
  // Crucially, model WHEN THE AGGREGATOR ITSELF IS SKIPPED. Its guard is
  // `!cancelled() && detect-changes.outputs.has_changes == 'true'`, so on a
  // RUN-level cancellation OR a no-changes push it never runs, and a skipped
  // job's outputs resolve to the EMPTY STRING — not 'false'. That distinction
  // is load-bearing twice over: it is what keeps an intentional run-level
  // cancel silent, and it is what stops `any_success == 'false'` from firing
  // the alert on every routine push that builds nothing.
  const cancelledLegs = legResults.filter((r) => r === "cancelled");
  const aggregatorRan =
    !(opts.runCancelled ?? false) && (opts.hasChanges ?? true);
  return {
    runCancelled: opts.runCancelled ?? false,
    needs: {
      "detect-changes": {
        outputs: { has_changes: String(opts.hasChanges ?? true) },
      },
      build: { result: rollupBuildResult(legResults) },
      "aggregate-build-results": {
        outputs: aggregatorRan
          ? {
              any_success: String(anySuccess),
              any_cancelled: String(cancelledLegs.length > 0),
              cancelled_services: cancelledLegs
                .map((_, i) => `svc-${i}`)
                .join(","),
            }
          : { any_success: "", any_cancelled: "", cancelled_services: "" },
      },
      // The STARTER lane, as it looks on a showcase-only change: no starter
      // paths changed, so `detect-starter-changes` reports 'false',
      // `redeploy-staging-starters` is skipped by its own guard, and a skipped
      // job's outputs resolve to the EMPTY STRING. Modelled explicitly (rather
      // than omitted) because `notify` reads
      // `redeploy-staging-starters.outputs.any_cancelled`, and because '' is
      // exactly what keeps the starter clause from adding noise here.
      "detect-starter-changes": { outputs: { has_changes: "false" } },
      "check-lockfile": { result: "success" },
      "verify-image-refs": { result: "success" },
      "build-starters": { result: "skipped" },
      "redeploy-staging": { result: "success" },
      "redeploy-staging-starters": {
        outputs: { any_cancelled: "", cancelled_starters: "" },
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
  // Derived through the LIVE case block, not restated: the CSV is built from
  // records whose recorded `status` is `success`.
  return legResults.some((leg) => recordStarterSlot(leg) === "success");
}

/**
 * The LIVE `job.status` → recorded-`status` mapping for each lane's per-slot
 * result writer, parsed out of the workflow's own shell.
 */
const recordShowcaseSlot = readSlotStatusMapper(
  "build",
  "Write per-slot build result",
);
const recordStarterSlot = readSlotStatusMapper(
  "build-starters",
  "Write per-slot starter build result",
);

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

// ---------------------------------------------------------------------------
// Regression guard for the notification jobs (`notify-all-builds-failed` and
// `notify`). They shared the redeploy job's cancelled-rollup blind spot: the
// former keyed off `needs.build.result == 'failure'` and the latter off a bare
// `failure()`, so a build where every real service FAILED but one leg was
// CANCELLED (runner contention) rolled the matrix up to 'cancelled' and sent
// NO alert. The authoritative "did anything build?" signal is the same one the
// redeploy fix uses — `aggregate-build-results.outputs.any_success`.
// ---------------------------------------------------------------------------
describe("notify-all-builds-failed guard — cancelled-rollup blind spot", () => {
  const guard = readJobGuard("notify-all-builds-failed");

  it("(a) fires when every leg is cancelled but nothing built (any_success=false)", () => {
    const legs = Array(28).fill("cancelled");
    const ctx = contextFor(legs, { runCancelled: false });
    expect(rollupBuildResult(legs)).toBe("cancelled"); // GH rolls up to cancelled
    expect(jobRuns(guard, ctx)).toBe(true); // ...but the alert still fires
  });

  it("(a2) fires on a clean all-failure build (unchanged behavior)", () => {
    const legs = Array(28).fill("failure");
    expect(jobRuns(guard, contextFor(legs))).toBe(true);
  });

  it("(b) does NOT fire when all legs succeed", () => {
    const legs = Array(28).fill("success");
    expect(jobRuns(guard, contextFor(legs))).toBe(false);
  });

  it("does NOT fire when one leg is cancelled but the rest succeeded", () => {
    const legs = [...Array(27).fill("success"), "cancelled"];
    expect(jobRuns(guard, contextFor(legs, { runCancelled: false }))).toBe(
      false,
    );
  });

  it("(c) does NOT fire when the whole RUN is cancelled", () => {
    const legs = Array(28).fill("cancelled");
    const ctx = contextFor(legs, { runCancelled: true });
    expect(jobRuns(guard, ctx)).toBe(false);
  });
});

describe("notify guard — cancelled-rollup blind spot", () => {
  const guard = readJobGuard("notify");

  it("(a) fires when every leg is cancelled but nothing built (any_success=false)", () => {
    const legs = Array(28).fill("cancelled");
    const ctx = contextFor(legs, { runCancelled: false });
    // No needs job resolved to 'failure' (matrix rolled up to 'cancelled'), so
    // the bare `failure()` guard would stay silent — the any_success clause is
    // what makes the alert fire.
    expect(anyDepFailed(ctx)).toBe(false);
    expect(jobRuns(guard, ctx)).toBe(true);
  });

  it("(a2) fires on a genuine build-job failure via failure() (unchanged behavior)", () => {
    const legs = Array(28).fill("failure");
    const ctx = contextFor(legs, { runCancelled: false });
    expect(anyDepFailed(ctx)).toBe(true);
    expect(jobRuns(guard, ctx)).toBe(true);
  });

  it("(b) does NOT fire when all legs succeed", () => {
    const legs = Array(28).fill("success");
    expect(jobRuns(guard, contextFor(legs))).toBe(false);
  });

  it("(c) does NOT fire when the whole RUN is cancelled", () => {
    const legs = Array(28).fill("cancelled");
    const ctx = contextFor(legs, { runCancelled: true });
    expect(jobRuns(guard, ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression guard for the SILENT PARTIAL-CANCEL hole.
//
// Production incident, build run 30162773601 (merge of #6160): a workflow-file
// edit forced a full-fleet rebuild, 5 of 28 slots were killed by their
// `timeout-minutes` budget, the other 23 built and WERE redeployed to staging
// (`redeploy-staging` succeeded and uploaded `redeploy-summary`), and:
//   - `notify` was SKIPPED — no Slack alert, no PR comment;
//   - the run rolled up to conclusion `cancelled`, failing
//     showcase_deploy.yml's `conclusion == 'success'` gate, so the staging
//     redeploy was never verified.
//
// Why every pre-existing guard missed it — measured on purpose-built probe run
// 30166429073, and consistent with the documented semantics of the status
// functions ("cancelled(): returns true if the workflow was canceled";
// "failure(): returns true if any ancestor job fails"):
//   - the killed leg's own `job.status` is `cancelled`;
//   - the matrix rollup `needs.build.result` is `cancelled`;
//   - `cancelled()` is FALSE — it is workflow-scoped, and the RUN was not
//     cancelled, only individual legs. (Confirmed in production too: both
//     `!cancelled()`-guarded jobs RAN in run 30162773601.)
//   - `failure()` is FALSE — a CANCELLED ancestor is not a FAILED ancestor.
//   - `any_success` is 'true' — 23 slots did build.
// So `failure() || cancelled()` would NOT have closed this. The only signal
// that survives is the per-slot one: `any_cancelled`.
// ---------------------------------------------------------------------------
describe("notify guard — silent partial-cancel hole (run 30162773601)", () => {
  const guard = readJobGuard("notify");

  /** The exact production shape: 23 slots built, 5 killed by timeout. */
  const partialCancelLegs = [
    ...Array(23).fill("success"),
    ...Array(5).fill("cancelled"),
  ];

  /**
   * The pre-fix `notify` guard, verbatim from origin/main. Kept as a literal
   * so the test proves the DIFFERENCE the fix makes rather than merely
   * asserting the current guard's behaviour. If this ever starts passing, the
   * model has drifted from GitHub's semantics.
   */
  const PRE_FIX_GUARD = `\${{ !cancelled()
          && (failure()
              || needs.aggregate-build-results.outputs.any_success == 'false') }}`;

  it("RED: the pre-fix guard stays SILENT on the production partial-cancel", () => {
    const ctx = contextFor(partialCancelLegs, { runCancelled: false });
    // Every clause the old guard had available goes the wrong way:
    expect(rollupBuildResult(partialCancelLegs)).toBe("cancelled");
    expect(anyDepFailed(ctx)).toBe(false); // failure() === false
    expect(ctx.runCancelled).toBe(false); // cancelled() === false
    expect(
      (
        ctx.needs["aggregate-build-results"] as {
          outputs: Record<string, string>;
        }
      ).outputs.any_success,
    ).toBe("true"); // the any_success clause === false
    expect(jobRuns(PRE_FIX_GUARD, ctx)).toBe(false); // ← the bug
  });

  it("GREEN: the live guard FIRES on the production partial-cancel", () => {
    const ctx = contextFor(partialCancelLegs, { runCancelled: false });
    expect(jobRuns(guard, ctx)).toBe(true);
  });

  it("adds no noise: still silent on a fully clean build", () => {
    const legs = Array(28).fill("success");
    expect(jobRuns(guard, contextFor(legs))).toBe(false);
  });

  it("adds no noise: still silent when a human cancels the whole RUN", () => {
    const ctx = contextFor(partialCancelLegs, { runCancelled: true });
    expect(jobRuns(guard, ctx)).toBe(false);
  });

  it("adds no noise: still silent when the build was skipped (no changes)", () => {
    // has_changes=false → the build matrix never runs and the aggregator is
    // skipped, so `any_cancelled` is '' — not 'true'.
    const ctx = contextFor([], { hasChanges: false });
    expect(jobRuns(guard, ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The job that turns a partially-cancelled build RED (so its conclusion is
// `failure`, not `cancelled`) and names the affected services in Slack.
// ---------------------------------------------------------------------------
describe("notify-cancelled-builds guard", () => {
  const guard = readJobGuard("notify-cancelled-builds");

  it("fires on the production partial-cancel (23 built, 5 killed)", () => {
    const legs = [...Array(23).fill("success"), ...Array(5).fill("cancelled")];
    const ctx = contextFor(legs, { runCancelled: false });
    expect(jobRuns(guard, ctx)).toBe(true);
  });

  it("fires when a single leg is cancelled and everything else built", () => {
    const legs = [...Array(27).fill("success"), "cancelled"];
    expect(jobRuns(guard, contextFor(legs, { runCancelled: false }))).toBe(
      true,
    );
  });

  it("fires when every leg was cancelled", () => {
    const legs = Array(28).fill("cancelled");
    expect(jobRuns(guard, contextFor(legs, { runCancelled: false }))).toBe(
      true,
    );
  });

  it("does NOT fire on a clean build", () => {
    expect(jobRuns(guard, contextFor(Array(28).fill("success")))).toBe(false);
  });

  it("does NOT fire on an all-FAILED build (that is notify's job, not ours)", () => {
    expect(jobRuns(guard, contextFor(Array(28).fill("failure")))).toBe(false);
  });

  it("does NOT fire when a human cancelled the whole RUN (intentional)", () => {
    const legs = [...Array(23).fill("success"), ...Array(5).fill("cancelled")];
    const ctx = contextFor(legs, { runCancelled: true });
    expect(jobRuns(guard, ctx)).toBe(false);
  });

  it("does NOT fire when there were no changes to build", () => {
    expect(jobRuns(guard, contextFor([], { hasChanges: false }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression guard for the SILENT PARTIAL-CANCEL hole in the STARTER lane.
//
// #6171 closed this hole for the showcase `build` lane only. The starter lane
// (`detect-starter-changes` → `build-starters` → `redeploy-staging-starters`)
// kept laundering `job.status: cancelled` into `skipped` in its per-slot
// result writer:
//
//     case "$BUILD_STATUS" in
//       success) STATUS=success ;;
//       failure) STATUS=failure ;;
//       *)       STATUS=skipped ;;    # ← cancelled lands here
//     esac
//
// The per-slot artifact is the ONLY place a leg-level cancellation survives:
// `cancelled()` is workflow-scoped (a killed leg does not cancel the RUN) and
// a CANCELLED ancestor did not FAIL, so `failure()` is false too — both
// measured on probe run 30166429073. With `cancelled` collapsed to `skipped`,
// a starter slot killed by `timeout-minutes` was indistinguishable from one
// that legitimately never built, so:
//   - the two fail-loud checks in `redeploy-staging-starters` are both gated
//     on `build-starters.result == 'success'` — and a cancelled leg rolls the
//     matrix up to `cancelled`, so neither can fire;
//   - `notify`'s three clauses were all keyed on the SHOWCASE aggregator, so
//     on a starter-only change (`detect-changes.has_changes == 'false'`) the
//     aggregator is skipped, its outputs are `''`, and `notify` was SKIPPED;
//   - nothing redded the run, and nothing named the starter to re-run.
// Net: no alert, no red, no `:latest` advance, no self-heal.
// ---------------------------------------------------------------------------
describe("build-starters per-slot writer — cancelled must not be laundered", () => {
  it("records a timeout-killed starter slot as 'cancelled', NOT 'skipped'", () => {
    // RED on pre-fix main: the `*)` catch-all returns 'skipped', which is
    // excluded from BOTH the redeploy success-set and any cancelled-slot
    // alert — the laundering that made the whole lane silent.
    expect(recordStarterSlot("cancelled")).toBe("cancelled");
  });

  it("records the other job.status values unchanged", () => {
    expect(recordStarterSlot("success")).toBe("success");
    expect(recordStarterSlot("failure")).toBe("failure");
  });

  it("keeps the defensive catch-all conservative (unknown → skipped)", () => {
    // `skipped` is the conservative fallback for a hypothetical fourth
    // job.status: excluded from the redeploy set AND from the alert.
    expect(recordStarterSlot("some-future-github-status")).toBe("skipped");
  });

  it("is byte-for-byte equivalent to the showcase lane's mapping", () => {
    // The two lanes' per-slot writers must agree on the contract; a drift
    // between them is exactly how the starter hole survived #6171.
    for (const status of [
      "success",
      "failure",
      "cancelled",
      "some-future-github-status",
    ]) {
      expect(recordStarterSlot(status)).toBe(recordShowcaseSlot(status));
    }
  });

  it("does not let a cancelled starter into the redeploy set", () => {
    // Unchanged invariant: a slot that pushed no image can never be deployed.
    expect(recordStarterSlot("cancelled")).not.toBe("success");
    expect(starterRedeployStepRuns(["cancelled", "cancelled"])).toBe(false);
    expect(starterRedeployStepRuns(["success", "cancelled"])).toBe(true);
  });
});

/**
 * Build a GH context for the jobs that consume the starter lane's
 * cancelled-slot outputs. `any_cancelled` / `cancelled_starters` are derived
 * from the per-slot records THROUGH THE LIVE CASE BLOCK — so if the writer
 * ever launders `cancelled` again, these contexts stop reporting it and every
 * assertion below flips, exactly as production would.
 *
 * `redeploy-staging-starters` is skipped (outputs `''`, not `'false'`) when the
 * whole RUN is cancelled or there are no starter changes, mirroring its own
 * `!cancelled() && has_changes == 'true'` guard.
 *
 * `detect-changes.has_changes` is 'false' and the showcase aggregator's outputs
 * are `''` throughout: this models a STARTER-ONLY change, the exact shape on
 * which `notify` was silent.
 */
function starterCancelContextFor(
  legResults: readonly string[],
  opts: { runCancelled?: boolean; hasChanges?: boolean } = {},
): GhContext {
  const runCancelled = opts.runCancelled ?? false;
  const hasChanges = opts.hasChanges ?? true;
  const cancelled = legResults
    .map((leg, i) => ({
      service: `starter-${i}`,
      status: recordStarterSlot(leg),
    }))
    .filter((r) => r.status === "cancelled")
    .map((r) => r.service);
  const starterRedeployRan = !runCancelled && hasChanges;
  return {
    runCancelled,
    needs: {
      "detect-changes": { outputs: { has_changes: "false" } },
      "detect-starter-changes": {
        outputs: { has_changes: String(hasChanges) },
      },
      "check-lockfile": { result: "success" },
      "verify-image-refs": { result: "success" },
      build: { result: "skipped" },
      "build-starters": { result: rollupBuildResult(legResults) },
      "aggregate-build-results": {
        outputs: { any_success: "", any_cancelled: "", cancelled_services: "" },
      },
      "redeploy-staging": { result: "skipped" },
      "redeploy-staging-starters": {
        outputs: starterRedeployRan
          ? {
              any_cancelled: String(cancelled.length > 0),
              cancelled_starters: cancelled.join(","),
            }
          : { any_cancelled: "", cancelled_starters: "" },
      },
    },
  };
}

describe("notify-cancelled-starter-builds guard", () => {
  // Read lazily (inside each test) so a MISSING job fails these tests
  // individually instead of blowing up collection for the whole file.
  const runs = (ctx: GhContext) =>
    jobRuns(
      readJobGuard("notify-cancelled-starter-builds"),
      ctx,
      "build-starters",
    );

  it("fires on a partial starter cancel (some built, one killed by timeout)", () => {
    const legs = [...Array(5).fill("success"), "cancelled"];
    const ctx = starterCancelContextFor(legs);
    // Every pre-existing signal goes the wrong way — this is the hole.
    expect(rollupBuildResult(legs)).toBe("cancelled"); // so the `== 'success'`-gated fail-louds are inert
    expect(anyDepFailed(ctx)).toBe(false); // failure() === false
    expect(ctx.runCancelled).toBe(false); // cancelled() === false
    expect(runs(ctx)).toBe(true); // ...and the new guard still fires
  });

  it("fires when every starter leg was cancelled", () => {
    expect(runs(starterCancelContextFor(Array(6).fill("cancelled")))).toBe(
      true,
    );
  });

  it("does NOT fire on a clean starter build", () => {
    expect(runs(starterCancelContextFor(Array(6).fill("success")))).toBe(false);
  });

  it("does NOT fire on an all-FAILED starter build (that is notify's job)", () => {
    expect(runs(starterCancelContextFor(Array(6).fill("failure")))).toBe(false);
  });

  it("does NOT fire when a human cancelled the whole RUN (intentional)", () => {
    const legs = [...Array(5).fill("success"), "cancelled"];
    expect(runs(starterCancelContextFor(legs, { runCancelled: true }))).toBe(
      false,
    );
  });

  it("does NOT fire when there were no starter changes", () => {
    expect(runs(starterCancelContextFor([], { hasChanges: false }))).toBe(
      false,
    );
  });
});

describe("notify guard — starter-only partial cancel", () => {
  const guard = readJobGuard("notify");
  const runs = (ctx: GhContext) => jobRuns(guard, ctx, "build-starters");

  /**
   * The pre-fix `notify` guard, verbatim from origin/main at the time the
   * starter hole was found. Pinned as a literal so these tests prove the
   * DIFFERENCE the fix makes rather than merely restating current behaviour.
   */
  const PRE_FIX_GUARD = `\${{ !cancelled()
          && (failure()
              || needs.aggregate-build-results.outputs.any_success == 'false'
              || needs.aggregate-build-results.outputs.any_cancelled == 'true') }}`;

  const partialCancelLegs = [...Array(5).fill("success"), "cancelled"];

  it("RED: the pre-fix guard stays SILENT on a starter-only partial cancel", () => {
    const ctx = starterCancelContextFor(partialCancelLegs);
    // A starter-only change skips the showcase aggregator, so all three of the
    // pre-fix clauses read '' or false. No Slack, no PR comment.
    expect(jobRuns(PRE_FIX_GUARD, ctx, "build-starters")).toBe(false);
  });

  it("GREEN: the live guard FIRES on a starter-only partial cancel", () => {
    expect(runs(starterCancelContextFor(partialCancelLegs))).toBe(true);
  });

  it("adds no noise: silent on a clean starter-only build", () => {
    expect(runs(starterCancelContextFor(Array(6).fill("success")))).toBe(false);
  });

  it("adds no noise: silent when a human cancels the whole RUN", () => {
    const ctx = starterCancelContextFor(partialCancelLegs, {
      runCancelled: true,
    });
    expect(runs(ctx)).toBe(false);
  });

  it("adds no noise: silent when there were no starter changes", () => {
    expect(runs(starterCancelContextFor([], { hasChanges: false }))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The expression model above proves the GUARDS fire on the right shapes, but
// it derives `any_cancelled` in TypeScript. These assertions pin the WIRING in
// between — the parts that carry the signal from the per-slot artifact to the
// guard — so deleting any single link breaks a test rather than silently
// re-opening the hole:
//   build-starters writer records `cancelled`   (covered by recordStarterSlot)
//     → redeploy-staging-starters derives it from the records   (here)
//     → and publishes it as a job output                        (here)
//     → notify-cancelled-starter-builds reads that output       (here)
//     → and exits non-zero so the run goes RED, not `cancelled` (here)
// ---------------------------------------------------------------------------
describe("starter cancelled-slot signal — end-to-end wiring", () => {
  const workflow = readWorkflow();

  it("redeploy-staging-starters derives the signal from the per-slot records", () => {
    const script = readStepScript(
      "redeploy-staging-starters",
      "Compute successfully-built starter services",
    );
    // It must select on the RECORDED status the writer emits — not on the
    // matrix, not on the rollup.
    expect(script).toMatch(/select\(\s*\.status\s*==\s*"cancelled"\s*\)/);
    // ...and publish both halves to $GITHUB_OUTPUT.
    expect(script).toMatch(/any_cancelled=true/);
    expect(script).toMatch(/any_cancelled=false/);
    expect(script).toMatch(/cancelled_starters=\$cancelled_starters/);
  });

  it("redeploy-staging-starters exposes the signal as job outputs", () => {
    const job = workflow.jobs["redeploy-staging-starters"];
    expect(job.outputs?.any_cancelled).toContain(
      "steps.changed.outputs.any_cancelled",
    );
    expect(job.outputs?.cancelled_starters).toContain(
      "steps.changed.outputs.cancelled_starters",
    );
  });

  it("notify-cancelled-starter-builds consumes that output and reds the run", () => {
    const guard = readJobGuard("notify-cancelled-starter-builds");
    expect(guard).toContain(
      "needs.redeploy-staging-starters.outputs.any_cancelled",
    );
    const job = workflow.jobs["notify-cancelled-starter-builds"];
    expect(job.needs).toContain("redeploy-staging-starters");
    // Step 1 must exit non-zero: that is what turns the run's conclusion from
    // `cancelled` (which suppresses downstream verification) into `failure`.
    const redStep = (job.steps ?? [])[0];
    expect(redStep?.run).toMatch(/exit 1/);
    // Step 2 must alert, naming the cancelled starters.
    const alertStep = (job.steps ?? [])[1];
    expect(alertStep?.with?.payload).toContain(
      "needs.redeploy-staging-starters.outputs.cancelled_starters",
    );
  });

  it("notify's PR comment names the cancelled starters", () => {
    const job = workflow.jobs["notify"];
    const comment = (job.steps ?? []).find((s) => s.name === "Comment on PR");
    expect(comment?.env?.CANCELLED_STARTERS).toContain(
      "needs.redeploy-staging-starters.outputs.cancelled_starters",
    );
    expect(comment?.with?.script).toContain("CANCELLED_STARTERS");
  });
});
