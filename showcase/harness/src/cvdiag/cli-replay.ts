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
 * Validate ONE raw row into a typed envelope or throw a `ReplayError` naming
 * `rowIndex`. Rejects: non-object rows (a bad-JSON row surfaces as a string or
 * primitive), rows missing any required envelope field, and rows whose
 * `edge_headers` / `metadata` are not objects.
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
  if (!isPlainObject(raw["edge_headers"])) {
    throw new ReplayError(rowIndex, `"edge_headers" is not an object`);
  }
  if (!isPlainObject(raw["metadata"])) {
    throw new ReplayError(rowIndex, `"metadata" is not an object`);
  }
  // All required fields present and the JSON columns are objects: the row is a
  // structurally-valid envelope. We do not re-derive the closed enums here —
  // the classifier tolerates unknown boundaries and replay is a faithful
  // reconstruction of what was stored, not a re-validation of enum membership.
  return raw as unknown as CvdiagEnvelope;
}

/**
 * Reconstruct the ordered envelope sequence from stored rows. Pure: no I/O, no
 * mutation of the input. Throws `ReplayError` on the FIRST malformed row.
 */
export function reconstructRequestSequence(rows: unknown[]): ReplayResult {
  const events: CvdiagEnvelope[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    events.push(validateRow(rows[i], i));
  }
  const ordered = sortByTimeline(events);
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
    const result = reconstructRequestSequence(rows);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof ReplayError) {
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
