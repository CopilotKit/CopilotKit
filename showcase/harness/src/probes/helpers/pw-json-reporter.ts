/**
 * Playwright JSON-reporter parser.
 *
 * Converts a raw Playwright JSON report (the `--reporter=json` shape)
 * into a typed per-spec-FILE verdict the fail-closed D6 rollup consumes.
 *
 * Verdict rules (per file):
 *   - `red`     — ANY case status is `failed` or `timedOut`. A
 *                 ran-and-failed file is never green.
 *   - `pass`    — at least one case ran AND every ran case is `passed`.
 *                 `skipped` cases are NEUTRAL: they neither block nor
 *                 manufacture a pass. A file whose only cases are skipped
 *                 has no passing case and is therefore `unknown`.
 *   - `unknown` — a file is present in the report but no case resolved to
 *                 a pass/fail signal (e.g. only skipped, or a reporter
 *                 quirk). Files with ZERO collected cases produce NO row
 *                 at all — the rollup maps absence → unknown — so the
 *                 parser can never manufacture green from an empty run.
 *
 * The Playwright JSON shape nests `suites[]` recursively; a top-level
 * suite carries a `file`, and describe blocks appear as child `suites`
 * that share the same file. We walk the whole tree, attribute each
 * `spec.tests[].results[]` status to its enclosing file (by basename),
 * and roll up per file.
 */

export type PwCaseStatus =
  | "passed"
  | "failed"
  | "timedOut"
  | "skipped"
  | "interrupted"
  | string;

export type FileVerdict = "pass" | "red" | "unknown";

export interface SpecFileResult {
  /** Basename of the spec file, e.g. `hitl-in-chat.spec.ts`. */
  specFile: string;
  /** Flat list of every collected case for this file. */
  cases: { title: string; status: PwCaseStatus }[];
  fileVerdict: FileVerdict;
}

interface PwResult {
  status?: PwCaseStatus;
}
interface PwTest {
  results?: PwResult[];
}
interface PwSpec {
  title?: string;
  tests?: PwTest[];
}
interface PwSuite {
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
interface PwReport {
  suites?: PwSuite[];
}

function basename(file: string): string {
  const parts = file.split("/");
  return parts[parts.length - 1] ?? file;
}

/**
 * Pick the most-significant status across a case's retry results. The
 * last result reflects the final attempt (Playwright appends a result
 * per retry); a case is `passed` only if its final result passed.
 */
function caseStatus(test: PwTest): PwCaseStatus | undefined {
  const results = test.results ?? [];
  if (results.length === 0) return undefined;
  return results[results.length - 1]?.status;
}

export function parsePlaywrightJson(report: unknown): SpecFileResult[] {
  const root = (report ?? {}) as PwReport;
  // Preserve first-seen file order for deterministic output.
  const byFile = new Map<string, { title: string; status: PwCaseStatus }[]>();

  const walk = (suite: PwSuite, inheritedFile: string | undefined): void => {
    const file = suite.file ?? inheritedFile;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const status = caseStatus(test);
        if (status === undefined) continue;
        // A case with no enclosing file is unattributable; skip it rather
        // than inventing a bogus row.
        if (file === undefined) continue;
        const key = basename(file);
        const list = byFile.get(key) ?? [];
        list.push({ title: spec.title ?? "", status });
        byFile.set(key, list);
      }
    }
    for (const child of suite.suites ?? []) {
      walk(child, file);
    }
  };

  for (const suite of root.suites ?? []) {
    walk(suite, undefined);
  }

  const out: SpecFileResult[] = [];
  for (const [specFile, cases] of byFile) {
    out.push({ specFile, cases, fileVerdict: verdict(cases) });
  }
  return out;
}

function verdict(cases: { status: PwCaseStatus }[]): FileVerdict {
  if (cases.length === 0) return "unknown";
  if (cases.some((c) => c.status === "failed" || c.status === "timedOut")) {
    return "red";
  }
  const passed = cases.filter((c) => c.status === "passed");
  const skipped = cases.filter((c) => c.status === "skipped");
  // pass iff at least one case ran-and-passed and every non-skipped case
  // passed. A file whose only cases are skipped never reaches pass.
  if (passed.length > 0 && passed.length + skipped.length === cases.length) {
    return "pass";
  }
  return "unknown";
}
