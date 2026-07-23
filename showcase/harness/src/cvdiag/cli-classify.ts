/**
 * cli-classify.ts — thin node entrypoint behind
 * `bin/showcase cvdiag --classify <test-id>` (L2-B). Pure glue over the L2-A
 * classifier: fetch one test's `cvdiag_events` rows via the superuser PB
 * client, hand them to `classify()`, and print the `ClassificationResult` as
 * JSON to stdout.
 *
 * All classification LOGIC lives in classifier.ts (read-only here); this file
 * only does I/O + ordering. The events are timeline-ordered before
 * classification so the classifier's "first/last per boundary" reads are the
 * genuine emit order (the classifier is order-tolerant for most rules, but a
 * faithful order keeps the evidence dump readable).
 *
 * Accounting (`cvdiag.*`) rows are filtered OUT before classification: the
 * classifier consumes only the 29 data-plane boundaries (a purge_audit /
 * queue_dropped row is pipeline accounting, not a probe data-plane event).
 */

import { createPbClient } from "../storage/pb-client.js";
import type { PbClient } from "../storage/pb-client.js";
import { logger } from "../logger.js";
import { loadCvdiagPbConfig, sortByTimeline } from "./cli-pb.js";
import { classify } from "./classifier.js";
import type { ClassificationResult } from "./classifier.js";
import { CVDIAG_EVENTS_COLLECTION } from "./pb-writer.js";
import type { CvdiagEventRecord } from "./pb-writer.js";
import { CVDIAG_ACCOUNTING_BOUNDARIES, isValidTestId } from "./schema.js";
import type { CvdiagEnvelope } from "./schema.js";

type StoredRow = CvdiagEventRecord & { id?: string };

const ACCOUNTING_SET: ReadonlySet<string> = new Set(
  CVDIAG_ACCOUNTING_BOUNDARIES,
);

/**
 * Map stored rows → ordered, data-plane-only envelopes and classify them.
 * Pure: no I/O, no input mutation. Exposed for unit testing the glue without
 * a live PB.
 */
export function classifyRows(
  testId: string,
  rows: CvdiagEnvelope[],
): ClassificationResult {
  const dataPlane = rows.filter((ev) => !ACCOUNTING_SET.has(ev.boundary));
  const ordered = sortByTimeline(dataPlane);
  return classify(testId, ordered);
}

async function fetchEvents(
  pb: PbClient,
  testId: string,
): Promise<CvdiagEnvelope[]> {
  const events: CvdiagEnvelope[] = [];
  let page = 1;
  for (;;) {
    const result = await pb.list<StoredRow>(CVDIAG_EVENTS_COLLECTION, {
      filter: `test_id = ${JSON.stringify(testId)}`,
      sort: "ts",
      perPage: 200,
      page,
      skipTotal: true,
    });
    // The classifier is read-only over typed envelopes; the stored rows are
    // structurally the persisted envelope (plus PB system fields it ignores).
    events.push(...(result.items as unknown as CvdiagEnvelope[]));
    if (result.items.length < 200) break;
    page += 1;
  }
  return events;
}

async function main(argv: string[]): Promise<number> {
  const testId = argv[0];
  if (!testId) {
    process.stderr.write("usage: cli-classify <test-id>\n");
    return 2;
  }
  if (!isValidTestId(testId)) {
    process.stderr.write(`cvdiag classify: invalid test-id "${testId}"\n`);
    return 2;
  }
  const cfg = loadCvdiagPbConfig();
  const pb = createPbClient({
    url: cfg.url,
    email: cfg.email,
    password: cfg.password,
    logger,
  });
  const events = await fetchEvents(pb, testId);
  const result = classifyRows(testId, events);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`cvdiag classify: ${String(err)}\n`);
      process.exit(1);
    },
  );
}
