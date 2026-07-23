/**
 * Playwright JSON reporter parser.
 *
 * Parses the output of `playwright test --reporter=json` and derives a
 * per-spec-file verdict for each targeted spec path.
 *
 * ## Playwright JSON shape (observed from Playwright 1.58–1.61)
 *
 * The JSON reporter emits:
 *   { suites[], errors[], stats }
 *
 * Top-level `suites[]` are keyed by file (suite.file = relative spec path).
 * Each suite contains `specs[]`, each spec contains `tests[]`, each test
 * contains `results[]`.
 *
 * ## Verdict derivation (per specPath)
 *
 * Given a targeted spec path, the parser classifies it as one of:
 *
 *   PASS        — The suite is present, at least one test result has
 *                 status "passed", and no genuine failures exist.
 *                 Mixed passed+skipped is PASS; skips alone are ZERO_TESTS.
 *
 *   FAIL        — The suite is present AND at least one effective result is a
 *                 genuine test-body failure: status "failed"/"timedOut"/
 *                 "interrupted" with duration > 0. Per-result statuses are
 *                 ground truth; spec.ok is NOT used to gate the FAIL verdict.
 *
 *   ERRORED     — Any of:
 *                 (a) The spec appears in top-level errors[] with a
 *                     location.file matching the specPath (collection-time
 *                     error — file threw at import time or had a syntax error,
 *                     so Playwright never populated a suite).
 *                 (b) The suite IS present but at least one result has a
 *                     failure status AND duration === 0 (Playwright's signature
 *                     for a beforeAll/setup hook crash — test body never ran).
 *                 (c) The report has any location-less error in errors[] AND
 *                     the spec-level verdict would otherwise be PASS (the run
 *                     was globally unreliable — fail-closed: promote to ERRORED).
 *
 *   ZERO_TESTS  — The spec file was targeted but no suite entry exists for
 *                 it in the report and no errors explain the absence (the file
 *                 produced no test definitions, or the run had no errors at all).
 *
 * Fail-closed: any ambiguous or missing state maps to ERRORED or ZERO_TESTS
 * rather than PASS. A spec must have all tests pass to get a PASS verdict.
 *
 * ## specPath matching
 *
 * Playwright's suite.file is a relative path from the testDir root (e.g.
 * "beautiful-chat.spec.ts"). Callers may pass absolute paths, relative paths,
 * or basename-only strings. The matcher normalises both sides and checks:
 *   1. Exact match after path normalisation.
 *   2. Suffix match (suite.file ends with the normalised targetted path, or
 *      the targeted path ends with the suite.file). This handles the common
 *      case where callers pass absolute paths but Playwright emits relative.
 *   3. Basename-only fallback — ONLY when the basename is unambiguous (exactly
 *      one suite in the report shares that basename). If multiple suites share
 *      the same basename (e.g. "chat/index.spec.ts" and "sidebar/index.spec.ts"
 *      both have basename "index.spec.ts"), the match is ambiguous and the spec
 *      is treated as missing (ZERO_TESTS / ERRORED). Fail-closed: a wrong
 *      attribution is worse than a missed match.
 */

/** Raw Playwright `--reporter=json` output shape (partial — only what we use). */
export interface PlaywrightTestResult {
  readonly status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  readonly duration: number;
  readonly error?: { readonly message?: string };
}

export interface PlaywrightTest {
  readonly title?: string;
  readonly results: readonly PlaywrightTestResult[];
  readonly status?: string;
}

export interface PlaywrightSpec {
  readonly title: string;
  readonly ok: boolean;
  readonly file: string;
  readonly tests: readonly PlaywrightTest[];
}

export interface PlaywrightSuite {
  readonly title: string;
  readonly file: string;
  readonly specs: readonly PlaywrightSpec[];
  readonly suites?: readonly PlaywrightSuite[];
}

export interface PlaywrightReportError {
  readonly message?: string;
  readonly location?: {
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
  };
}

export interface PlaywrightJsonReport {
  readonly suites: readonly PlaywrightSuite[];
  readonly errors: readonly PlaywrightReportError[];
  readonly stats?: {
    readonly expected?: number;
    readonly unexpected?: number;
    readonly skipped?: number;
  };
}

/**
 * Verdict for a single spec file.
 *
 *   PASS       — All tests ran and passed (at least one passing test, no failures).
 *   FAIL       — At least one test failed with a genuine assertion/timeout error.
 *   ERRORED    — The spec could not run: collection-time import error, runtime
 *                setup-hook crash, interrupted/global runner error, or the
 *                report had location-less errors (fail-closed: ambiguous run).
 *   ZERO_TESTS — The spec file produced no test evidence:
 *                (a) the file was targeted but no suite entry exists and no
 *                    errors were recorded (truly empty or absent spec), OR
 *                (b) the spec ran but ALL tests were skipped — no passing
 *                    evidence, no failures. Fail-closed: treated as non-PASS.
 *                ZERO_TESTS maps to an UNKNOWN cell on the dashboard (same as
 *                ERRORED), so both a and b are visible as "no data" rather
 *                than a false green.
 */
export type SpecVerdict = "PASS" | "FAIL" | "ERRORED" | "ZERO_TESTS";

export interface SpecResult {
  /** The spec path as provided by the caller. */
  readonly specPath: string;
  /**
   * Flat list of test titles seen in this spec.
   *
   * Population rules:
   *   - PASS / FAIL / ZERO_TESTS: titles from the suite's spec entries.
   *   - ERRORED (collection): empty — no suite entry exists (file never ran).
   *   - ERRORED (runtime): titles ARE populated when the suite exists
   *     (beforeAll/setup crash — Playwright recorded the spec entries even
   *     though the test bodies never executed).
   */
  readonly tests: readonly string[];
  /** Derived verdict for this spec file. */
  readonly status: SpecVerdict;
}

/**
 * Flatten suites recursively. Playwright may nest suites (e.g. `describe`
 * blocks create inner suites), but spec-level verdicts are computed from the
 * leaf specs regardless of nesting depth.
 */
function flattenSpecs(suite: PlaywrightSuite): readonly PlaywrightSpec[] {
  const own = suite.specs ?? [];
  const children = (suite.suites ?? []).flatMap(flattenSpecs);
  return [...own, ...children];
}

/**
 * Collect all specs across all top-level suites, annotated with their
 * suite file (the top-level suite.file, which is the spec file path as
 * Playwright emits it).
 */
function collectSpecsBySuiteFile(
  report: PlaywrightJsonReport,
): Map<string, readonly PlaywrightSpec[]> {
  const map = new Map<string, PlaywrightSpec[]>();
  for (const suite of report.suites) {
    const key = suite.file;
    const existing = map.get(key) ?? [];
    const specs = flattenSpecs(suite);
    map.set(key, [...existing, ...specs]);
  }
  return map;
}

/**
 * Check whether two spec path strings refer to the same file via exact or
 * suffix match (does NOT include basename-only fallback — that requires
 * ambiguity checking across all suites, done in findSpecsForTarget).
 *
 * Handles: absolute vs relative, different separators.
 */
function specPathMatchesStrict(suiteFile: string, targetPath: string): boolean {
  // Normalise: use forward slashes, trim whitespace
  const a = suiteFile.replace(/\\/g, "/").trim();
  const b = targetPath.replace(/\\/g, "/").trim();
  if (a === b) return true;
  // Suffix match: covers absolute-caller vs relative-suite-file
  if (b.endsWith("/" + a) || a.endsWith("/" + b)) return true;
  return false;
}

/**
 * Check whether two spec path strings refer to the same file by basename only.
 * Used only as a last-resort fallback within findSpecsForTarget, which guards
 * for ambiguity before accepting a basename match.
 */
function specPathMatchesBasename(
  suiteFile: string,
  targetPath: string,
): boolean {
  const a = suiteFile.replace(/\\/g, "/").trim();
  const b = targetPath.replace(/\\/g, "/").trim();
  const aBase = a.split("/").at(-1) ?? a;
  const bBase = b.split("/").at(-1) ?? b;
  return aBase === bBase;
}

/**
 * Find the specs for a given target path in the suite-file map.
 *
 * Matching strategy (in priority order):
 *   1. Exact or suffix match (specPathMatchesStrict) — collects ALL strict
 *      candidates and returns the match only if EXACTLY ONE is found.
 *      Multiple strict matches (e.g. "index.spec.ts" suffix-matching both
 *      "chat/index.spec.ts" and "sidebar/index.spec.ts") are ambiguous.
 *   2. Basename-only fallback — only when EXACTLY ONE suite shares the
 *      basename. If multiple suites share the basename (collision), the match
 *      is ambiguous and null is returned.
 *
 * Ambiguity rule (H2-2): any collision — whether via suffix or basename — must
 * never silently attribute the wrong suite's result to the caller's target.
 * Fail-closed: ambiguous match → null (treated as missing / UNKNOWN).
 * Callers should use unambiguous paths (full relative or absolute).
 */
function findSpecsForTarget(
  specsBySuiteFile: Map<string, readonly PlaywrightSpec[]>,
  targetPath: string,
): { suiteFile: string; specs: readonly PlaywrightSpec[] } | null {
  // Pass 1: collect ALL exact / suffix matches
  const strictMatches: Array<{
    suiteFile: string;
    specs: readonly PlaywrightSpec[];
  }> = [];
  for (const [suiteFile, specs] of specsBySuiteFile) {
    if (specPathMatchesStrict(suiteFile, targetPath)) {
      strictMatches.push({ suiteFile, specs });
    }
  }
  // Unambiguous if exactly one strict candidate
  if (strictMatches.length === 1) return strictMatches[0]!;
  // Multiple strict matches → ambiguous (fail-closed)
  if (strictMatches.length > 1) return null;

  // Pass 2: basename fallback — collect ALL candidates first
  const basenameMatches: Array<{
    suiteFile: string;
    specs: readonly PlaywrightSpec[];
  }> = [];
  for (const [suiteFile, specs] of specsBySuiteFile) {
    if (specPathMatchesBasename(suiteFile, targetPath)) {
      basenameMatches.push({ suiteFile, specs });
    }
  }

  // Unambiguous if exactly one candidate; otherwise fail-closed (null → UNKNOWN)
  if (basenameMatches.length === 1) {
    return basenameMatches[0]!;
  }

  // Zero matches or multiple matches (ambiguous collision) → null
  return null;
}

/**
 * Check whether a collection-time error in the report's top-level errors[]
 * matches the targeted spec path.
 *
 * An error with a blank/empty location.file is treated as location-less (not
 * matched against any spec path) — same as if location were absent entirely.
 *
 * Ambiguity guard (mirrors findSpecsForTarget): collects ALL matching errors
 * and returns true only when EXACTLY ONE matches. A suffix match that hits
 * multiple errors (e.g. targetPath "foo.spec.ts" suffix-matching both
 * "bar/foo.spec.ts" and "baz/foo.spec.ts") is ambiguous — the error cannot
 * be reliably attributed to this specific target. Ambiguous → fall through
 * to the suite verdict rather than pre-empting a present-and-failing suite
 * with a wrong ERRORED attribution.
 *
 * Fail-closed: a wrong attribution (real FAIL → ERRORED) is worse than a
 * missed match.
 */
function hasCollectionError(
  report: PlaywrightJsonReport,
  targetPath: string,
): boolean {
  // Collect ALL strict matches — detect ambiguity before attributing.
  const matches: string[] = [];
  for (const err of report.errors ?? []) {
    const file = err.location?.file;
    // Treat blank/whitespace-only file as location-less (fail-closed: H2-3)
    if (file && file.trim() !== "" && specPathMatchesStrict(file, targetPath)) {
      matches.push(file);
    }
  }
  // Unambiguous only when exactly one error matches.
  // Multiple matches → ambiguous; do not attribute (fall through to suite verdict).
  return matches.length === 1;
}

/**
 * Select the effective (final-outcome) result for a single test, honouring
 * Playwright's retry semantics.
 *
 * When retries are enabled Playwright appends one result entry per attempt.
 * The last entry is the final outcome.  We return only that entry so that a
 * flaky-then-passing retry scores PASS, not FAIL.
 *
 * For tests with no results (shouldn't happen in practice) we return null.
 */
function effectiveResult(test: PlaywrightTest): PlaywrightTestResult | null {
  if (test.results.length === 0) return null;
  return test.results[test.results.length - 1]!;
}

/**
 * Return true when a test result is a genuine test-body failure (assertion,
 * timeout, etc.) as opposed to a setup/hook crash.
 *
 * The authoritative discriminator is `duration`:
 *   - duration > 0 → the test body was dispatched and ran (even if it failed)
 *   - duration === 0 → the test body never started (beforeAll threw, runner
 *     killed before dispatch)
 *
 * For "failed" status: Playwright records `result.error` for BOTH genuine
 * assertion failures AND beforeAll hook crashes (the hook's stack trace is
 * attached to each test that never ran). Error presence is therefore NOT a
 * reliable discriminator at duration === 0 — we must rely on duration alone.
 * Fail-closed: duration === 0 is treated as a setup crash (ERRORED) regardless
 * of whether result.error is present.
 *
 * For "timedOut" / "interrupted": the test body ran long enough to be killed;
 * duration > 0 confirms dispatch occurred.
 */
function isGenuineTestFailure(result: PlaywrightTestResult): boolean {
  const isFailureStatus =
    result.status === "failed" ||
    result.status === "timedOut" ||
    result.status === "interrupted";
  return isFailureStatus && result.duration > 0;
}

/**
 * Return true when a test result is a setup/hook crash (ERRORED territory).
 *
 * This covers:
 *   - duration === 0 with any failure status (test body never ran)
 *   - timedOut/interrupted at duration === 0 (process killed before dispatch)
 */
function isSetupCrash(result: PlaywrightTestResult): boolean {
  const isFailureStatus =
    result.status === "failed" ||
    result.status === "timedOut" ||
    result.status === "interrupted";
  return isFailureStatus && result.duration === 0;
}

/**
 * Derive the verdict for a set of specs belonging to a single spec file.
 *
 * Uses the *final* result of each test (last retry) rather than any
 * intermediate retry attempt, so a flaky-then-passing retry scores PASS.
 *
 * ## Precedence rule
 *
 * Per-result statuses are ground truth for verdict derivation.  `spec.ok` is
 * NOT used here — it is a Playwright aggregate flag that can disagree with
 * per-result statuses in edge cases (threshold-based flakiness tracking,
 * Playwright version quirks).  Flaky-pass disambiguation is handled naturally
 * by `effectiveResult()`: the last retry result is the final outcome, so a
 * spec that retried and ultimately passed has a final result of "passed" and
 * will not be classified as a failure, without needing to gate on `spec.ok`.
 *
 * FAIL:
 *   At least one effective result is a genuine test-body failure:
 *   "failed" / "timedOut" / "interrupted" with duration > 0 (the test body
 *   was dispatched and ran, even if it failed or was killed).
 *   duration > 0 is the authoritative discriminator — result.error presence
 *   is NOT used to promote a duration:0 result to FAIL, because Playwright
 *   attaches the beforeAll hook stack trace to every blocked test's result,
 *   making error presence unreliable at duration === 0.
 *
 * ERRORED (runtime):
 *   At least one effective result has a failure status AND duration === 0:
 *   the test body never ran (beforeAll/setup hook crashed, or runner killed
 *   before dispatch). This applies regardless of whether result.error is
 *   present — duration:0 is the sole discriminator (fail-closed).
 *   FAIL takes priority: if any genuine duration > 0 failure exists, FAIL wins.
 *
 * ZERO_TESTS:
 *   The suite is present but ALL effective results are "skipped" — no passing
 *   evidence, no failures.  Fail-closed: never PASS without evidence.
 *
 * PASS:
 *   All effective results are "passed" or "skipped", with at least one
 *   "passed" result.  Mixed passed+skipped is PASS (skips do not poison).
 */
function deriveVerdictFromSpecs(specs: readonly PlaywrightSpec[]): SpecVerdict {
  // Collect per-test final (effective) results.  spec.ok is deliberately not
  // used for verdict derivation — see precedence rule in the JSDoc above.
  const results: PlaywrightTestResult[] = [];
  for (const spec of specs) {
    for (const test of spec.tests) {
      const r = effectiveResult(test);
      if (r !== null) {
        results.push(r);
      }
    }
  }

  if (results.length === 0) {
    // Suite present but no test results — treat as ERRORED (fail-closed).
    return "ERRORED";
  }

  // FAIL takes priority: a genuine test-body failure overrides everything.
  const hasGenuineFailure = results.some(isGenuineTestFailure);
  if (hasGenuineFailure) {
    return "FAIL";
  }

  // All-skipped: no passing evidence → ZERO_TESTS (maps to UNKNOWN on dashboard).
  const allSkipped = results.every((r) => r.status === "skipped");
  if (allSkipped) {
    return "ZERO_TESTS";
  }

  // Setup crash: at least one test never ran (beforeAll threw, runner killed).
  const hasAnyCrash = results.some(isSetupCrash);
  if (hasAnyCrash) {
    return "ERRORED";
  }

  // PASS: at least one "passed" result and no failures (mixed passed+skipped OK).
  const hasAnyPass = results.some((r) => r.status === "passed");
  if (hasAnyPass) {
    return "PASS";
  }

  // Remaining ambiguous state — fail-closed.
  return "ERRORED";
}

/**
 * Collect test titles for a set of specs.
 *
 * Returns per-test titles (test.title when present, falling back to the
 * containing spec's title for backward compatibility with Playwright versions
 * that do not emit test.title).
 */
function collectTestTitles(
  specs: readonly PlaywrightSpec[],
): readonly string[] {
  return specs.flatMap((s) => s.tests.map((t) => t.title ?? s.title));
}

/**
 * Parse a Playwright `--reporter=json` output and derive per-spec verdicts
 * for a given list of targeted spec paths.
 *
 * @param report   Parsed JSON from `playwright test --reporter=json`
 * @param specPaths Spec file paths to classify (relative or absolute)
 * @returns        One SpecResult per entry in specPaths (same order)
 */
export function parsePlaywrightJsonReport(
  report: PlaywrightJsonReport,
  specPaths: readonly string[],
): SpecResult[] {
  const specsBySuiteFile = collectSpecsBySuiteFile(report);

  // Pre-compute the location-less error flag once.  A location-less error
  // indicates a global runner failure (OOM, global-setup crash, "No tests
  // found") that makes the entire run unreliable, regardless of whether a
  // spec's suite entry was recorded.  Fail-closed: any spec in such a run
  // that would otherwise return PASS must be promoted to ERRORED.
  //
  // Blank/whitespace-only location.file is treated as location-less (H2-3):
  // an empty file field provides no meaningful attribution.
  //
  // Normalize report.errors to [] when absent/null (H2-1): some Playwright
  // versions may omit the field entirely.
  const errors = report.errors ?? [];
  const hasLocationlessError = errors.some(
    (err) =>
      err.location?.file === undefined ||
      err.location?.file === null ||
      err.location.file.trim() === "",
  );

  return specPaths.map((specPath): SpecResult => {
    // 1. Check for collection-time error first (most specific signal).
    if (hasCollectionError(report, specPath)) {
      return { specPath, tests: [], status: "ERRORED" };
    }

    // 2. Find the suite entry for this spec.
    const found = findSpecsForTarget(specsBySuiteFile, specPath);
    if (!found) {
      // No suite and no location-matched collection error.  If the run
      // had any location-less errors, the run itself errored — fail-closed:
      // ERRORED rather than ZERO_TESTS so a broken run never looks like an
      // empty spec.
      if (hasLocationlessError) {
        return { specPath, tests: [], status: "ERRORED" };
      }
      // No suite, no collection error, no runner errors → file produced zero test cases.
      return { specPath, tests: [], status: "ZERO_TESTS" };
    }

    const { specs } = found;
    const verdict = deriveVerdictFromSpecs(specs);
    const tests = collectTestTitles(specs);

    // 3. If the run had a global error (location-less), a spec-level PASS
    //    verdict is unreliable — the runner may have exited before all tests
    //    ran.  Promote PASS → ERRORED; other verdicts (FAIL, ERRORED,
    //    ZERO_TESTS) are already fail-closed and need no promotion.
    if (hasLocationlessError && verdict === "PASS") {
      return { specPath, tests, status: "ERRORED" };
    }

    return { specPath, tests, status: verdict };
  });
}
