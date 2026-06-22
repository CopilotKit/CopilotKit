/**
 * cli-purge.ts — back `bin/showcase cvdiag --purge <selector>` (L2-B). Deletes
 * the matching `cvdiag_events` rows AND cascade-deletes the corresponding
 * `cvdiag_raw_byte_samples` rows, THEN emits a `cvdiag.purge_audit` accounting
 * event (via `CvdiagPbWriter`) recording how many rows of each kind were
 * purged.
 *
 * CASCADE ORDER (spec §4 on-demand purge): both collections key on `test_id`,
 * so a `test_id` selector cascades cleanly. A `slug` selector deletes events by
 * slug and the raw-byte samples by slug too (both carry `slug`). The audit is
 * emitted LAST, after both deletes resolve, so its counts are the ACTUAL purge
 * tally — never a pre-count that a partial failure could overstate.
 *
 * KEY SPLIT: deletes run under the PB `purge` key (DELETE-only); the audit
 * write runs under the `writer` key (CREATE-only) — the same split the
 * migration's three-key ACL enforces. The CLI authenticates as the superuser
 * (which bypasses the ACL), so both surfaces work through one connection; the
 * writer/purge separation is preserved structurally via the two distinct
 * client objects passed in.
 *
 * The pure core `purgeCvdiag(args, deps)` takes its PB-delete + audit-emit
 * surfaces as injected deps so it is unit-testable against fakes (no live PB).
 */

import { createPbClient } from "../storage/pb-client.js";
import { logger } from "../logger.js";
import { loadCvdiagPbConfig } from "./cli-pb.js";
import {
  CvdiagPbWriter,
  CVDIAG_EVENTS_COLLECTION,
  CVDIAG_RAW_BYTE_SAMPLES_COLLECTION,
} from "./pb-writer.js";
import { isValidTestId } from "./schema.js";

/** Default operator id stamped on the audit when the env does not name one. */
const DEFAULT_OPERATOR_ID = "cli";

export interface PurgeArgs {
  /** A `test_id` (UUIDv7) or a `slug`. */
  selector: string;
  /** Who ran the purge (audit attribution). */
  operatorId: string;
}

/**
 * The minimal PB delete surface the purge needs: `deleteByFilter` returns the
 * count actually removed (the real `PbClient` satisfies this structurally).
 */
export interface PurgeDeleteClient {
  deleteByFilter(collection: string, filter: string): Promise<number>;
}

/** The minimal audit-emit surface: just the purge-audit write. */
export interface PurgeAuditWriter {
  writePurgeAudit(audit: {
    operator_id: string;
    target_predicate: string;
    row_count_events: number;
    row_count_raw_bytes: number;
  }): Promise<void>;
}

export interface PurgeDeps {
  pb: PurgeDeleteClient;
  writer: PurgeAuditWriter;
}

export interface PurgeResult {
  rowCountEvents: number;
  rowCountRawBytes: number;
  targetPredicate: string;
}

/**
 * Build the PB filter for a selector. A UUIDv7 selector targets `test_id`;
 * anything else is treated as a `slug`. Values are JSON-quoted so a selector
 * cannot inject filter syntax.
 */
function buildFilter(selector: string): { field: string; filter: string } {
  const field = isValidTestId(selector) ? "test_id" : "slug";
  return { field, filter: `${field} = ${JSON.stringify(selector)}` };
}

/**
 * Purge matching events + cascade raw-byte samples, then emit the purge_audit.
 * Pure over its injected deps; returns the actual purged counts. The audit emit
 * always happens AFTER both deletes resolve.
 */
export async function purgeCvdiag(
  args: PurgeArgs,
  deps: PurgeDeps,
): Promise<PurgeResult> {
  const { field, filter } = buildFilter(args.selector);
  const targetPredicate = filter;

  // Delete events first, then cascade to the raw-byte samples. Both key on the
  // same selector field (test_id | slug), so the cascade is the same filter.
  const rowCountEvents = await deps.pb.deleteByFilter(
    CVDIAG_EVENTS_COLLECTION,
    filter,
  );
  const rowCountRawBytes = await deps.pb.deleteByFilter(
    CVDIAG_RAW_BYTE_SAMPLES_COLLECTION,
    filter,
  );

  // Emit the audit LAST so the recorded counts reflect the actual purge.
  await deps.writer.writePurgeAudit({
    operator_id: args.operatorId,
    target_predicate: targetPredicate,
    row_count_events: rowCountEvents,
    row_count_raw_bytes: rowCountRawBytes,
  });

  logger.info("cvdiag.cli.purge", {
    selector_field: field,
    target_predicate: targetPredicate,
    row_count_events: rowCountEvents,
    row_count_raw_bytes: rowCountRawBytes,
  });

  return { rowCountEvents, rowCountRawBytes, targetPredicate };
}

async function main(argv: string[]): Promise<number> {
  const selector = argv[0];
  if (!selector) {
    process.stderr.write("usage: cli-purge <selector (test-id | slug)>\n");
    return 2;
  }
  const cfg = loadCvdiagPbConfig();
  const pb = createPbClient({
    url: cfg.url,
    email: cfg.email,
    password: cfg.password,
    logger,
  });
  const writer = new CvdiagPbWriter({ pb, logger });
  const operatorId = process.env.CVDIAG_OPERATOR_ID || DEFAULT_OPERATOR_ID;

  const result = await purgeCvdiag({ selector, operatorId }, { pb, writer });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`cvdiag purge: ${String(err)}\n`);
      process.exit(1);
    },
  );
}
