/**
 * cli-ab-report.ts — thin node entrypoint behind
 * `bin/showcase cvdiag --ab-report [records.json]` (L2-B). Pure glue over the
 * L2-A report engine `ab-report.ts`: read the collected `AbOutcomeRecord[]`,
 * hand them to `computeAbReport()`, and print the `AbReport` as JSON to stdout.
 *
 * WHY this reads serialized records (and does NOT fetch a PB collection like
 * cli-classify / cli-replay do): the A/B arm outcomes are NOT persisted to a
 * queryable PB collection. They ride in-memory through the d4 driver's
 * `AbOutcomeCollector.collect()` sink (see d4-chat-roundtrip.ts) — there is no
 * `cvdiag_ab` migration, and `ab_pair_id` / per-arm role are deliberately NOT
 * in the closed-world `cvdiag_events` metadata key set (see ab-report.ts module
 * header). The only durable medium for these records is the JSON the collector
 * serializes, so the CLI consumes that JSON (a file-path arg, or stdin) rather
 * than inventing a PB query against a collection that does not exist.
 *
 * Reads from a file when a path arg is given, else from stdin. The records are
 * validated into the closed `AbOutcomeRecord` shape before the engine sees them
 * (a malformed record is a HARD error naming the offending index), mirroring
 * cli-replay's "reject malformed rows, never silently drop, never crash"
 * contract. All report LOGIC lives in ab-report.ts (read-only here).
 */

import { readFileSync } from "node:fs";

import { computeAbReport } from "./ab-report.js";
import type { AbArm, AbOutcomeRecord } from "./ab-report.js";
import { CVDIAG_OUTCOMES } from "./schema.js";
import type { CvdiagOutcome } from "./schema.js";

const VALID_ARMS: ReadonlySet<string> = new Set<AbArm>(["edge", "internal"]);
const VALID_OUTCOMES: ReadonlySet<string> = new Set<CvdiagOutcome>(
  CVDIAG_OUTCOMES,
);

/**
 * Thrown when an input record cannot be validated into an `AbOutcomeRecord`.
 * The message names the offending index + reason so an operator can locate the
 * bad record in the serialized collector output.
 */
export class AbReportInputError extends Error {
  readonly recordIndex: number;
  constructor(recordIndex: number, detail: string) {
    super(`cvdiag ab-report: malformed record ${recordIndex}: ${detail}`);
    this.name = "AbReportInputError";
    this.recordIndex = recordIndex;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  raw: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = raw[field];
  if (typeof value !== "string") {
    throw new AbReportInputError(
      index,
      `field "${field}" must be a string, got ${typeof value}`,
    );
  }
  return value;
}

/**
 * Like `requireString` but ALSO rejects empty / whitespace-only values. Used
 * for the correlation keys (`ab_pair_id`, `test_id`): an empty `ab_pair_id`
 * would group unrelated rows into one bogus pair under the "" key, fabricating
 * a spurious `edge-only-failure` verdict, so it must be rejected at validation
 * time rather than silently grouped.
 */
function requireNonEmptyString(
  raw: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = requireString(raw, field, index);
  if (value.trim().length === 0) {
    throw new AbReportInputError(
      index,
      `field "${field}" must be a non-empty string`,
    );
  }
  return value;
}

/**
 * Validate ONE raw record into a typed `AbOutcomeRecord` or throw an
 * `AbReportInputError` naming `index`. Rejects non-object records, missing /
 * wrong-typed fields, and out-of-enum `arm` / `outcome` values.
 */
function validateRecord(raw: unknown, index: number): AbOutcomeRecord {
  if (!isPlainObject(raw)) {
    throw new AbReportInputError(
      index,
      `expected a JSON object, got ${raw === null ? "null" : typeof raw}`,
    );
  }
  const arm = requireString(raw, "arm", index);
  if (!VALID_ARMS.has(arm)) {
    throw new AbReportInputError(index, `invalid arm "${arm}"`);
  }
  const outcome = requireString(raw, "outcome", index);
  if (!VALID_OUTCOMES.has(outcome)) {
    throw new AbReportInputError(index, `invalid outcome "${outcome}"`);
  }
  const interference = raw["edge_interference_signal"];
  if (typeof interference !== "boolean") {
    throw new AbReportInputError(
      index,
      `field "edge_interference_signal" must be a boolean, got ${typeof interference}`,
    );
  }
  return {
    ab_pair_id: requireNonEmptyString(raw, "ab_pair_id", index),
    arm: arm as AbArm,
    test_id: requireNonEmptyString(raw, "test_id", index),
    slug: requireString(raw, "slug", index),
    demo: requireString(raw, "demo", index),
    outcome: outcome as CvdiagOutcome,
    edge_interference_signal: interference,
  };
}

/**
 * Parse the serialized collector output (a JSON array of arm outcome records)
 * into validated `AbOutcomeRecord[]`. Pure: no I/O. Throws `AbReportInputError`
 * on the FIRST malformed record, or on a non-array top-level value.
 */
export function parseAbRecords(text: string): AbOutcomeRecord[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new AbReportInputError(
      -1,
      `input is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new AbReportInputError(-1, "expected a top-level JSON array");
  }
  return parsed.map((raw, i) => validateRecord(raw, i));
}

/** Read the whole of stdin synchronously (the records arrive as one blob). */
function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    // No piped stdin (e.g. a TTY with nothing fed) → treat as empty input.
    return "";
  }
}

async function main(argv: string[]): Promise<number> {
  const path = argv[0];
  const text =
    path !== undefined && path.length > 0
      ? readFileSync(path, "utf8")
      : readStdin();
  const records = parseAbRecords(text);
  const report = computeAbReport(records);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

// Direct-invocation guard: only run main() when executed as a script (tsx),
// never when imported by a test. `import.meta.url` ends with this file.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      if (err instanceof AbReportInputError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      process.stderr.write(`cvdiag ab-report: ${String(err)}\n`);
      process.exit(1);
    },
  );
}
