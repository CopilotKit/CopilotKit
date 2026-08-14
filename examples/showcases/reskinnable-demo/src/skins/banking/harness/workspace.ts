import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessSummary } from "./types";

/**
 * The harness's scratch directory. Shared by both arms.
 *
 * The harness reports its verdict by WRITING `summary.json`, which we then read
 * — we never parse the model's prose. That matters twice: the result cannot be
 * corrupted by a chatty final message, and writing a file is exactly the "little
 * program" behaviour that makes a coding harness beat a chat turn on 14 rows.
 */

/** Create a per-run scratch dir holding `expenses.csv`. */
export const prepareWorkspace = async (
  csvText: string,
): Promise<{ dir: string; summaryPath: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "harness-"));
  await writeFile(join(dir, "expenses.csv"), csvText, "utf8");
  return { dir, summaryPath: join(dir, "summary.json") };
};

/** The keys the report card renders as dollar figures. All four are required. */
const NUMERIC_FIELDS = [
  "rowsRead",
  "merchantsSearched",
  "totalExpensable",
  "totalPersonal",
] as const;

/**
 * The shape guard. A cast is not validation: the harness writes this file with a
 * shell, so the ONLY thing we know about it is that it is a string on disk.
 *
 * Every rejection here is a summary that would otherwise render as a beautiful,
 * confident, EMPTY report card — the failure mode this app's notes warn about
 * hardest. `{}` is the worst of them, because it parses, satisfies a cast, and
 * renders as "0 rows, $0.00" with no error anywhere.
 */
const assertSummaryShape = (
  value: unknown,
  summaryPath: string,
): Omit<HarnessSummary, "elapsedSeconds"> => {
  const reject = (why: string): never => {
    throw new Error(
      `The harness wrote an unusable summary.json at ${summaryPath}: ${why}. ` +
        `Refusing to render it — an empty report card looks identical to a ` +
        `correct one. Check the progress log for what the harness actually did.`,
    );
  };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return reject(
      `expected a JSON object, got ${
        Array.isArray(value) ? "an array" : typeof value
      }`,
    );
  }

  const record = value as Record<string, unknown>;

  for (const field of NUMERIC_FIELDS) {
    if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
      return reject(
        `\`${field}\` must be a finite number, got ${JSON.stringify(record[field])}`,
      );
    }
  }

  if (!Array.isArray(record.verdicts)) {
    return reject(
      `\`verdicts\` must be an array, got ${JSON.stringify(record.verdicts)}`,
    );
  }
  if (record.verdicts.length === 0) {
    return reject(
      "`verdicts` is empty, so there is nothing to report — the harness read " +
        "rows but filed no decisions",
    );
  }

  return record as unknown as Omit<HarnessSummary, "elapsedSeconds">;
};

/**
 * Read the harness's structured verdict. Throws with a diagnostic rather than
 * returning a hollow summary — an empty report card that renders perfectly is
 * the failure mode this app's failure-modes notes warn about most.
 *
 * All three failure paths (no file, unparseable file, unusable shape) name the
 * path and the harness, so the operator can go straight to the progress log.
 */
export const readSummary = async (
  summaryPath: string,
  elapsedSeconds: number,
): Promise<HarnessSummary> => {
  let raw: string;
  try {
    raw = await readFile(summaryPath, "utf8");
  } catch {
    throw new Error(
      `The harness never wrote summary.json at ${summaryPath}. It either ` +
        `failed before finishing or ignored the instruction to write the file. ` +
        `Check the progress log for its last tool call.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `The harness wrote unparseable JSON to summary.json at ${summaryPath}: ` +
        `${cause instanceof Error ? cause.message : String(cause)}. The file ` +
        `exists but is not valid JSON — check the progress log for what it wrote.`,
      { cause },
    );
  }

  return { ...assertSummaryShape(parsed, summaryPath), elapsedSeconds };
};
