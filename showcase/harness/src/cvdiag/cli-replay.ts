/**
 * cli-replay.ts — reconstruct the ordered CVDIAG request sequence for one
 * `test_id` from its stored `cvdiag_events` rows, VALIDATING every row before
 * it is admitted to the reconstruction (L2-B). Backs
 * `bin/showcase cvdiag --replay <test-id>`.
 *
 * Two surfaces:
 *   - `reconstructRequestSequence(rows)` — PURE: takes the already-fetched PB
 *     rows (each a parsed JSON object as `pb-client` returns from `res.json()`)
 *     and returns the ordered `CvdiagEnvelope[]`. It REJECTS malformed rows
 *     (a row that is not a plain object, or one missing a required envelope
 *     field) by throwing a `ReplayError` naming the offending row index and
 *     field — it NEVER crashes on bad input. This is the unit under test.
 *   - the `main()` entrypoint — thin glue: build a superuser PB client from
 *     the env, fetch the rows for the test-id, call the pure function, and
 *     print the reconstructed sequence as JSON to stdout. Invoked by the
 *     shell command via `npx tsx src/cvdiag/cli-replay.ts <test-id>`.
 *
 * WHY validate here (and not lean on the emit-time validator): purge/migration
 * keys or a manual PB edit could in principle leave a partial row in the
 * collection. Replay reconstructs an authoritative request timeline, so a
 * malformed row must be a HARD error the operator sees — not silently dropped
 * (which would hide a gap) and not a crash (which would hide the cause).
 */

import { createPbClient } from "../storage/pb-client.js";
import type { PbClient } from "../storage/pb-client.js";
import { logger } from "../logger.js";
import { loadCvdiagPbConfig, sortByTimeline } from "./cli-pb.js";
import { CVDIAG_EVENTS_COLLECTION } from "./pb-writer.js";
import type { CvdiagEventRecord } from "./pb-writer.js";
import { ENVELOPE_KEYS, isValidTestId } from "./schema.js";
import type { CvdiagEnvelope } from "./schema.js";

/**
 * A stored `cvdiag_events` row as it arrives from `pb-client.list()`. The PB
 * `json` columns (`edge_headers`, `metadata`) are already-parsed objects, and
 * PB stamps its own `id`/`created`/`updated` system fields which we ignore.
 * This is structurally the persisted `CvdiagEventRecord` plus those system
 * fields — we re-validate the envelope fields rather than trust the shape.
 */
export type StoredCvdiagRow = CvdiagEventRecord & {
  id?: string;
  created?: string;
  updated?: string;
};

/**
 * Thrown when a stored row cannot be reconstructed into a valid envelope. The
 * message always names the offending row index and the specific reason so an
 * operator can locate and repair (or purge) the bad row.
 */
export class ReplayError extends Error {
  readonly rowIndex: number;
  constructor(rowIndex: number, detail: string) {
    super(`cvdiag replay: malformed row ${rowIndex}: ${detail}`);
    this.name = "ReplayError";
    this.rowIndex = rowIndex;
  }
}

/**
 * Thrown when the reconstructed sequence does not authoritatively belong to the
 * QUERIED test-id: either no rows came back at all (an empty timeline printed at
 * exit 0 would be a falsely-authoritative "nothing happened" answer) or a row's
 * `test_id` diverges from the one requested (a mixed-test result must never be
 * silently admitted into an authoritative timeline). This is a hard error the
 * operator sees, not a mislabeled or empty-but-success result.
 */
export class ReplayScopeError extends Error {
  constructor(detail: string) {
    super(`cvdiag replay: ${detail}`);
    this.name = "ReplayScopeError";
  }
}

export interface ReplayResult {
  testId: string;
  events: CvdiagEnvelope[];
}

/**
 * The required (non-optional) envelope fields a stored row MUST carry to be a
 * reconstructable event. `_metadata_dropped` / `_truncated` are emitter-stamped
 * optionals and `parent_span_id` / `duration_ms` are nullable-but-present, so
 * they are validated for PRESENCE (the key exists) below, not non-null.
 */
const REQUIRED_ENVELOPE_FIELDS = ENVELOPE_KEYS.filter(
  (k) => k !== "_metadata_dropped" && k !== "_truncated",
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Required envelope fields that MUST carry a non-empty string value. `test_id`
 * keys the timeline scope and `ts` is the cross-layer sort clock — a
 * present-but-wrong-typed value (the documented manual-PB-edit case) here
 * silently corrupts ordering, so we reject it at validation time.
 */
const STRING_FIELDS = [
  "test_id",
  "trace_id",
  "span_id",
  "layer",
  "boundary",
  "slug",
  "demo",
  "ts",
  "outcome",
] as const;

/** Required envelope fields that MUST be a finite number. */
const NUMBER_FIELDS = ["schema_version", "mono_ns"] as const;

/**
 * Required envelope fields that are nullable-but-typed: `parent_span_id` is a
 * `string | null` and `duration_ms` is a `number | null`. A non-null value of
 * the wrong type is rejected; an explicit `null` is accepted.
 */
const NULLABLE_STRING_FIELDS = ["parent_span_id"] as const;
const NULLABLE_NUMBER_FIELDS = ["duration_ms"] as const;

/**
 * Validate ONE raw row into a typed envelope or throw a `ReplayError` naming
 * `rowIndex`. Rejects: non-object rows (a bad-JSON row surfaces as a string or
 * primitive), rows missing any required envelope field, rows whose required
 * fields are present but of the WRONG TYPE (a manual-PB-edit row with a
 * non-string `ts`/`test_id` or a non-number `mono_ns` would otherwise pass a
 * presence-only check, then poison `sortByTimeline`'s `mono_ns` subtraction
 * into `NaN` and silently mis-order the authoritative timeline at exit 0), and
 * rows whose `edge_headers` / `metadata` are not objects.
 */
function validateRow(raw: unknown, rowIndex: number): CvdiagEnvelope {
  if (!isPlainObject(raw)) {
    throw new ReplayError(
      rowIndex,
      `expected a JSON object, got ${raw === null ? "null" : typeof raw}`,
    );
  }
  for (const field of REQUIRED_ENVELOPE_FIELDS) {
    if (!(field in raw)) {
      throw new ReplayError(rowIndex, `missing required field "${field}"`);
    }
  }
  // Type-check every required field per the envelope schema. Presence is not
  // enough: the `ts`/`mono_ns` sort clock and the `test_id` scope key must be
  // the right type or the reconstruction is silently corrupt.
  for (const field of STRING_FIELDS) {
    const value = raw[field];
    if (typeof value !== "string") {
      throw new ReplayError(
        rowIndex,
        `field "${field}" must be a string, got ${typeof value}`,
      );
    }
    if (value.length === 0) {
      throw new ReplayError(
        rowIndex,
        `field "${field}" must be a non-empty string`,
      );
    }
  }
  for (const field of NUMBER_FIELDS) {
    const value = raw[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ReplayError(
        rowIndex,
        `field "${field}" must be a finite number, got ${
          typeof value === "number" ? String(value) : typeof value
        }`,
      );
    }
  }
  for (const field of NULLABLE_STRING_FIELDS) {
    const value = raw[field];
    if (value !== null && typeof value !== "string") {
      throw new ReplayError(
        rowIndex,
        `field "${field}" must be a string or null, got ${typeof value}`,
      );
    }
  }
  for (const field of NULLABLE_NUMBER_FIELDS) {
    const value = raw[field];
    if (
      value !== null &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new ReplayError(
        rowIndex,
        `field "${field}" must be a finite number or null, got ${
          typeof value === "number" ? String(value) : typeof value
        }`,
      );
    }
  }
  if (!isPlainObject(raw["edge_headers"])) {
    throw new ReplayError(rowIndex, `"edge_headers" is not an object`);
  }
  if (!isPlainObject(raw["metadata"])) {
    throw new ReplayError(rowIndex, `"metadata" is not an object`);
  }
  // All required fields present and correctly typed and the JSON columns are
  // objects: the row is a structurally-valid envelope. We do not re-derive the
  // closed enums here — the classifier tolerates unknown boundaries and replay
  // is a faithful reconstruction of what was stored, not a re-validation of
  // enum membership.
  return raw as unknown as CvdiagEnvelope;
}

/**
 * Reconstruct the ordered envelope sequence from stored rows. Pure: no I/O, no
 * mutation of the input. Throws `ReplayError` on the FIRST malformed row.
 *
 * When `expectedTestId` is supplied (the live `main()` path always knows the
 * test-id it queried), the reconstruction is asserted to AUTHORITATIVELY belong
 * to that id: an empty result and any row whose `test_id` diverges from the
 * queried one are HARD errors (`ReplayScopeError`) — never a mislabeled or
 * empty-but-success timeline printed at exit 0. When omitted, the derived
 * `testId` falls back to the first row's id (or `"<none>"`) for callers that
 * reconstruct without a known query scope.
 */
export function reconstructRequestSequence(
  rows: unknown[],
  expectedTestId?: string,
): ReplayResult {
  const events: CvdiagEnvelope[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    events.push(validateRow(rows[i], i));
  }
  const ordered = sortByTimeline(events);
  if (expectedTestId !== undefined) {
    if (ordered.length === 0) {
      throw new ReplayScopeError(
        `no rows found for test-id "${expectedTestId}" — cannot reconstruct an authoritative timeline`,
      );
    }
    for (const ev of ordered) {
      if (ev.test_id !== expectedTestId) {
        throw new ReplayScopeError(
          `row test_id "${ev.test_id}" does not match the queried test-id "${expectedTestId}" — refusing a mixed-test timeline`,
        );
      }
    }
    return { testId: expectedTestId, events: ordered };
  }
  const testId = ordered[0]?.test_id ?? "<none>";
  return { testId, events: ordered };
}

/** Fetch all stored rows for a `test_id`, newest-index-agnostic (sorted later). */
async function fetchRows(
  pb: PbClient,
  testId: string,
): Promise<StoredCvdiagRow[]> {
  const rows: StoredCvdiagRow[] = [];
  let page = 1;
  // The test_id index makes this a cheap scan; page through in case a single
  // test emitted more than one PB page of boundaries.
  for (;;) {
    const result = await pb.list<StoredCvdiagRow>(CVDIAG_EVENTS_COLLECTION, {
      filter: `test_id = ${JSON.stringify(testId)}`,
      sort: "ts",
      perPage: 200,
      page,
      skipTotal: true,
    });
    rows.push(...result.items);
    if (result.items.length < 200) break;
    page += 1;
  }
  return rows;
}

async function main(argv: string[]): Promise<number> {
  const testId = argv[0];
  if (!testId) {
    process.stderr.write("usage: cli-replay <test-id>\n");
    return 2;
  }
  if (!isValidTestId(testId)) {
    process.stderr.write(`cvdiag replay: invalid test-id "${testId}"\n`);
    return 2;
  }
  const cfg = loadCvdiagPbConfig();
  const pb = createPbClient({
    url: cfg.url,
    email: cfg.email,
    password: cfg.password,
    logger,
  });
  const rows = await fetchRows(pb, testId);
  try {
    const result = reconstructRequestSequence(rows, testId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof ReplayError || err instanceof ReplayScopeError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

// Direct-invocation guard: only run main() when executed as a script (tsx),
// never when imported by a test. `import.meta.url` ends with this file.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`cvdiag replay: ${String(err)}\n`);
      process.exit(1);
    },
  );
}
