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

/**
 * Read the harness's structured verdict. Throws with a diagnostic rather than
 * returning a hollow summary — an empty report card that renders perfectly is
 * the failure mode this app's failure-modes notes warn about most.
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
  const parsed = JSON.parse(raw) as Omit<HarnessSummary, "elapsedSeconds">;
  return { ...parsed, elapsedSeconds };
};
