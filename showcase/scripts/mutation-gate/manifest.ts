/**
 * Mutation-gate manifest: types, loading, and the PURE parts of the gate —
 * schema validation, anchor resolution, and outcome classification.
 *
 * Split out from `mutation-gate.ts` (the CLI runner) so the cheap half can be
 * asserted by `showcase/scripts/__tests__/mutation-gate-manifest.test.ts`,
 * which runs in `showcase_validate.yml`'s existing `showcase/scripts` vitest
 * step. That test catches manifest ROT (an anchor string that no longer occurs,
 * or occurs twice, after a refactor) without executing a single mutation.
 *
 * WHY THIS EXISTS. Across two 12-reviewer rounds on PR #6156 the single most
 * effective review technique was mutation testing: break the implementation and
 * check whether the tests notice. Three different agents wrote those mutations
 * BY HAND, independently, and threw them away each time — while the findings
 * they produced ("the cap can be silently halved with the bounds suite 6/6
 * green") stayed true. This file makes those mutations a committed, re-runnable
 * artifact instead of transcript archaeology.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * A single textual transformation. `find` must occur EXACTLY ONCE in `file` —
 * zero occurrences means the manifest has rotted, more than one means the
 * mutation is ambiguous. Both abort the run rather than guessing.
 */
export interface MutantEdit {
  /** Repo-root-relative POSIX path. */
  file: string;
  /** Exact substring to replace. Must occur exactly once. */
  find: string;
  /** Replacement text. */
  replace: string;
}

/**
 * What the manifest CLAIMS the declared scope does when this mutation is
 * applied.
 *
 * - `kill`    — the declared tests in `mustFail` MUST fail. If they pass, a
 *               guard has gone toothless and the gate fails. This is the point
 *               of the tool.
 * - `survive` — the mutation is KNOWN to slip past the declared scope today.
 *               A `knownGap` is mandatory: an entry may only claim "survive"
 *               with a written reason and a pointer to the lever that closes
 *               it. If a `survive` entry starts getting killed the gate ALSO
 *               fails — a manifest that lies about guard strength is the same
 *               disease one level up. The fix is a two-line promotion of the
 *               entry to `kill` with the test names, in the same PR as the fix.
 */
export type MutantExpectation = "kill" | "survive";

export interface MutantKnownGap {
  /**
   * - `coverage-gap` — the tests SHOULD see this and do not. A toothless guard.
   * - `by-design`    — the mutation is genuinely behaviour-preserving (e.g. a
   *                    documented defence-in-depth redundancy), so a green
   *                    suite is correct rather than negligent. Recording it
   *                    stops the next reviewer re-deriving the same non-finding.
   */
  kind: "coverage-gap" | "by-design";
  /** Why the declared scope cannot see this mutation. */
  reason: string;
  /** The lever / follow-up that would close it, so the entry is actionable. */
  closedBy: string;
}

export interface Mutant {
  /** Stable `area/short-name` identifier. Used in reports and `--only`. */
  id: string;
  /** Where this mutation came from — report file and section. */
  provenance: string;
  /** The defect class this mutation checks the tests can still see. */
  guards: string;
  /** Key into `MutationManifest.suites`. */
  suite: string;
  edits: MutantEdit[];
  /** Test paths (suite-package-relative) handed to vitest. */
  scope: string[];
  expect: MutantExpectation;
  /**
   * Vitest `fullName`s that must appear as FAILED. Required (and non-empty)
   * when `expect === "kill"`; must be absent/empty when `expect === "survive"`.
   */
  mustFail?: string[];
  knownGap?: MutantKnownGap;
  /** Optional per-mutant override of the suite timeout, in milliseconds. */
  timeoutMs?: number;
}

export interface MutationSuite {
  /** Repo-root-relative package directory the vitest run happens in. */
  package: string;
  /** Package-relative path to the vitest binary. */
  vitestBin: string;
  /** Default per-run timeout, in milliseconds. */
  timeoutMs: number;
  /**
   * Human note on how to make the suite runnable (artifact generation etc.).
   * Not executed — the runner refuses to mutate a tree it had to prepare.
   */
  requires?: string;
}

export interface MutationManifest {
  /**
   * `owner/name` the origin remote MUST resolve to. The runner edits source by
   * design; it verifies this before touching a single byte, so a mis-pinned
   * worktree (a real failure mode: an agent's writes once landed in a dotfiles
   * repo) aborts instead of mutating the wrong tree.
   */
  expectedRemoteSlug: string;
  suites: Record<string, MutationSuite>;
  mutants: Mutant[];
}

// ---------------------------------------------------------------------------
// Loading + validation
// ---------------------------------------------------------------------------

export const MANIFEST_FILENAME = "mutants.json";

export function manifestPath(): string {
  return path.join(import.meta.dirname, MANIFEST_FILENAME);
}

export function loadManifest(file = manifestPath()): MutationManifest {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as MutationManifest;
  const errors = validateManifest(parsed);
  if (errors.length > 0) {
    throw new Error(
      `mutation-gate: ${file} is invalid:\n  - ${errors.join("\n  - ")}`,
    );
  }
  return parsed;
}

/** Structural validation. Returns a list of human-readable problems. */
export function validateManifest(m: MutationManifest): string[] {
  const errors: string[] = [];
  if (typeof m.expectedRemoteSlug !== "string" || !m.expectedRemoteSlug) {
    errors.push("`expectedRemoteSlug` must be a non-empty string");
  }
  if (!m.suites || Object.keys(m.suites).length === 0) {
    errors.push("`suites` must declare at least one suite");
  }
  for (const [name, s] of Object.entries(m.suites ?? {})) {
    if (!s.package) errors.push(`suite \`${name}\`: missing \`package\``);
    if (!s.vitestBin) errors.push(`suite \`${name}\`: missing \`vitestBin\``);
    if (!(typeof s.timeoutMs === "number" && s.timeoutMs > 0)) {
      errors.push(`suite \`${name}\`: \`timeoutMs\` must be a positive number`);
    }
  }
  if (!Array.isArray(m.mutants) || m.mutants.length === 0) {
    errors.push("`mutants` must be a non-empty array");
    return errors;
  }
  const seen = new Set<string>();
  for (const mut of m.mutants) {
    const at = `mutant \`${mut.id ?? "<no id>"}\``;
    if (!mut.id) errors.push(`${at}: missing \`id\``);
    else if (seen.has(mut.id)) errors.push(`${at}: duplicate \`id\``);
    else seen.add(mut.id);
    if (!mut.provenance) errors.push(`${at}: missing \`provenance\``);
    if (!mut.guards) errors.push(`${at}: missing \`guards\``);
    if (!m.suites?.[mut.suite]) {
      errors.push(
        `${at}: \`suite\` "${mut.suite}" is not declared in \`suites\``,
      );
    }
    if (!Array.isArray(mut.edits) || mut.edits.length === 0) {
      errors.push(`${at}: \`edits\` must be a non-empty array`);
    }
    for (const [i, e] of (mut.edits ?? []).entries()) {
      if (!e.file) errors.push(`${at} edit[${i}]: missing \`file\``);
      else if (path.isAbsolute(e.file) || e.file.includes("..")) {
        errors.push(
          `${at} edit[${i}]: \`file\` must be a repo-relative path without \`..\``,
        );
      }
      if (!e.find) errors.push(`${at} edit[${i}]: missing \`find\``);
      if (typeof e.replace !== "string") {
        errors.push(`${at} edit[${i}]: missing \`replace\``);
      }
      if (e.find === e.replace) {
        errors.push(`${at} edit[${i}]: \`find\` and \`replace\` are identical`);
      }
    }
    if (!Array.isArray(mut.scope) || mut.scope.length === 0) {
      errors.push(`${at}: \`scope\` must be a non-empty array`);
    }
    if (mut.expect === "kill") {
      if (!Array.isArray(mut.mustFail) || mut.mustFail.length === 0) {
        errors.push(
          `${at}: \`expect: "kill"\` requires a non-empty \`mustFail\``,
        );
      }
      if (mut.knownGap) {
        errors.push(
          `${at}: \`knownGap\` is meaningless with \`expect: "kill"\``,
        );
      }
    } else if (mut.expect === "survive") {
      if (mut.mustFail && mut.mustFail.length > 0) {
        errors.push(
          `${at}: \`expect: "survive"\` must not declare \`mustFail\` tests`,
        );
      }
      if (!mut.knownGap?.reason || !mut.knownGap?.closedBy) {
        errors.push(
          `${at}: \`expect: "survive"\` requires \`knownGap.reason\` and ` +
            `\`knownGap.closedBy\` — an entry may not claim a guard is ` +
            `toothless without saying why and what closes it`,
        );
      }
      if (
        mut.knownGap &&
        mut.knownGap.kind !== "coverage-gap" &&
        mut.knownGap.kind !== "by-design"
      ) {
        errors.push(
          `${at}: \`knownGap.kind\` must be "coverage-gap" or "by-design"`,
        );
      }
    } else {
      errors.push(`${at}: \`expect\` must be "kill" or "survive"`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Anchor resolution (pure — no writes)
// ---------------------------------------------------------------------------

export interface AnchorProblem {
  mutantId: string;
  file: string;
  occurrences: number;
  find: string;
}

/**
 * Assert every edit's `find` occurs exactly once in its target file, reading
 * from `repoRoot`. Zero occurrences = the manifest has rotted against a
 * refactor; more than one = the mutation is ambiguous.
 */
export function resolveAnchors(
  m: MutationManifest,
  repoRoot: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
): AnchorProblem[] {
  const problems: AnchorProblem[] = [];
  const cache = new Map<string, string>();
  for (const mut of m.mutants) {
    for (const e of mut.edits) {
      const abs = path.join(repoRoot, e.file);
      let src = cache.get(abs);
      if (src === undefined) {
        try {
          src = read(abs);
        } catch {
          problems.push({
            mutantId: mut.id,
            file: e.file,
            occurrences: -1,
            find: e.find,
          });
          continue;
        }
        cache.set(abs, src);
      }
      const n = countOccurrences(src, e.find);
      if (n !== 1) {
        problems.push({
          mutantId: mut.id,
          file: e.file,
          occurrences: n,
          find: e.find,
        });
      }
    }
  }
  return problems;
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

export function describeAnchorProblem(p: AnchorProblem): string {
  const where = `${p.mutantId} → ${p.file}`;
  if (p.occurrences === -1) return `${where}: file could not be read`;
  if (p.occurrences === 0) {
    return (
      `${where}: anchor NOT FOUND — the code moved and this mutation no ` +
      `longer tests anything. Re-anchor it or delete the entry. Anchor: ` +
      JSON.stringify(truncate(p.find))
    );
  }
  return (
    `${where}: anchor occurs ${p.occurrences}× — ambiguous, widen it to a ` +
    `unique span. Anchor: ${JSON.stringify(truncate(p.find))}`
  );
}

function truncate(s: string, n = 90): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

// ---------------------------------------------------------------------------
// Outcome classification (pure)
// ---------------------------------------------------------------------------

export type Verdict =
  /** expect:kill, every declared test failed. The guard has teeth. */
  | "KILLED"
  /** expect:kill, at least one declared test still passed. TOOTHLESS GUARD. */
  | "SURVIVED"
  /** expect:survive, nothing failed. Toothless as declared. */
  | "SURVIVED_AS_DECLARED"
  /** expect:survive, something failed. The manifest is stale — promote it. */
  | "GAP_CLOSED"
  /** The scope did not produce a usable measurement (load/transform error). */
  | "ERROR"
  /** The scope was not green before mutation, so nothing can be concluded. */
  | "BASELINE_DIRTY"
  /** The run exceeded its timeout. */
  | "TIMEOUT";

export interface TestOutcome {
  fullName: string;
  status: string;
}

export interface RunMeasurement {
  /** Every assertion result vitest reported, across the scope. */
  tests: TestOutcome[];
  /** File-level load/transform errors, if any. */
  loadErrors: string[];
  timedOut: boolean;
}

export interface Classification {
  verdict: Verdict;
  /** True if this outcome must fail the gate. */
  fatal: boolean;
  detail: string;
}

export function classify(
  mut: Mutant,
  run: RunMeasurement,
  opts: { allowFixed?: boolean } = {},
): Classification {
  if (run.timedOut) {
    return {
      verdict: "TIMEOUT",
      fatal: true,
      detail: `scope exceeded its timeout; no measurement (a timeout is not a kill)`,
    };
  }
  if (run.loadErrors.length > 0) {
    return {
      verdict: "ERROR",
      fatal: true,
      detail:
        `the mutated scope failed to LOAD (${run.loadErrors.length} file ` +
        `error(s)) — a syntactically broken mutation fails everything and ` +
        `measures nothing: ${run.loadErrors[0]}`,
    };
  }
  if (run.tests.length === 0) {
    return {
      verdict: "ERROR",
      fatal: true,
      detail: "the scope reported zero tests; check `scope` paths",
    };
  }
  const failed = new Set(
    run.tests.filter((t) => t.status === "failed").map((t) => t.fullName),
  );

  if (mut.expect === "survive") {
    if (failed.size === 0) {
      return {
        verdict: "SURVIVED_AS_DECLARED",
        fatal: false,
        detail:
          `${run.tests.length} test(s) still green under the mutation, as the ` +
          `manifest declares. ` +
          `${mut.knownGap!.kind === "by-design" ? "BY DESIGN" : "TOOTHLESS"}: ` +
          `${mut.knownGap!.reason} (closed by: ${mut.knownGap!.closedBy})`,
      };
    }
    return {
      verdict: "GAP_CLOSED",
      fatal: !opts.allowFixed,
      detail:
        `the manifest declares this mutation SURVIVES, but ${failed.size} ` +
        `test(s) now fail — the gap has been closed. PROMOTE this entry to ` +
        `\`expect: "kill"\` with mustFail: ${JSON.stringify([...failed])}. ` +
        `(Re-run with --allow-fixed to downgrade this to a warning.)`,
    };
  }

  const declared = mut.mustFail ?? [];
  const unknown = declared.filter(
    (name) => !run.tests.some((t) => t.fullName === name),
  );
  if (unknown.length > 0) {
    return {
      verdict: "ERROR",
      fatal: true,
      detail:
        `mustFail names ${unknown.length} test(s) the scope does not contain ` +
        `— renamed or removed: ${JSON.stringify(unknown)}`,
    };
  }
  const survivors = declared.filter((name) => !failed.has(name));
  if (survivors.length === 0) {
    return {
      verdict: "KILLED",
      fatal: false,
      detail: `all ${declared.length} declared test(s) failed`,
    };
  }
  return {
    verdict: "SURVIVED",
    fatal: true,
    detail:
      `TOOTHLESS GUARD — ${survivors.length}/${declared.length} declared ` +
      `test(s) still PASSED with the mutation applied: ` +
      `${JSON.stringify(survivors)}. Either the guard lost its teeth or the ` +
      `mutation no longer expresses the defect. Guards: ${mut.guards}`,
  };
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
