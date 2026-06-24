/// <reference path="../pb_data/types.d.ts" />
//
// DEBUG-tier raw-byte capture for CVDIAG flap observability (spec §11.4 /
// Phase 2.5). When a probe sees a 200-but-empty assistant response, the
// raw-byte capture pipeline (showcase/harness/src/cvdiag raw-byte-capture,
// L2-C) records a redacted head+tail slice of the offending payload so the
// drop can be inspected post-hoc. This is STRICTLY DEBUG-tier, per-slug,
// time-bounded (≤24h retention), and PII-scrubbed BEFORE it lands here —
// never write secrets, auth tokens, or unscrubbed bodies.
//
// ACL: identical split to cvdiag_events (1779990200). Reuses the SAME
// cvdiag_api_keys auth collection (created there): writer=CREATE,
// purge=DELETE. API UPDATEs are FORBIDDEN for everyone (updateRule=null) —
// this collection is append-only (CREATE-only writer + DELETE-only purge),
// so no key needs UPDATE. (Unlike cvdiag_events, cvdiag_raw_byte_samples has
// NO schema_version column, so there is no schema_version backfill here.)
// list/view require auth; anonymous GET → 401/403. The superuser bypasses all
// rules (role split only observable as a role-keyed cvdiag_api_keys identity).
// The on-demand purge (§4) cascades DELETEs here alongside cvdiag_events.
migrate(
  (db) => {
    const dao = new Dao(db);

    // Depends on 1779990200 having created cvdiag_api_keys. Fail loud if
    // the auth collection is missing — running this migration without it
    // would silently produce an unenforceable ACL.
    dao.findCollectionByNameOrId("cvdiag_api_keys");

    // Idempotency: no-op on re-apply.
    try {
      dao.findCollectionByNameOrId("cvdiag_raw_byte_samples");
      return;
    } catch {
      // Not present — fall through to create.
    }

    const c = new Collection({
      name: "cvdiag_raw_byte_samples",
      type: "base",
      schema: [
        // Correlation key back to the cvdiag_events timeline for this probe.
        { name: "test_id", type: "text", required: true },
        // Integration slug the sample belongs to.
        { name: "slug", type: "text" },
        // ISO-8601 wall-clock timestamp of capture.
        { name: "ts", type: "text", required: true },
        // Ordered list of pipeline stages applied before persisting
        // (e.g. ["decode","scrub","html-strip"]).
        { name: "pipeline_applied", type: "json", options: { maxSize: 2000 } },
        // Redacted leading slice of the captured payload (≤ byte cap).
        { name: "head_bytes", type: "text" },
        // Redacted trailing slice of the captured payload (≤ byte cap).
        { name: "tail_bytes", type: "text" },
        // Count of bytes elided between head and tail.
        { name: "elided_count", type: "number" },
        // True if the emit-time validator dropped unknown metadata keys.
        { name: "metadata_dropped", type: "bool" },
      ],
      indexes: [
        // Per-test lookup, newest-first.
        "CREATE INDEX IF NOT EXISTS idx_cvdiag_raw_byte_samples_test_id_ts ON cvdiag_raw_byte_samples (test_id, ts DESC)",
      ],
      // superuser-ONLY read (null), matching cvdiag_events: anonymous GET →
      // 401/403, not an empty 200. The role keys are write-only; reads go
      // via the superuser (CLI / dashboard / purge cascade).
      listRule: null,
      viewRule: null,
      createRule:
        '@request.auth.collectionName = "cvdiag_api_keys" && @request.auth.role = "writer"',
      // updateRule = null → ALL API UPDATEs forbidden (immutable, append-only
      // history). This collection has no schema_version column to backfill, so
      // (unlike cvdiag_events 1779990200) nothing ever needs UPDATE here.
      updateRule: null,
      deleteRule:
        '@request.auth.collectionName = "cvdiag_api_keys" && @request.auth.role = "purge"',
    });
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    try {
      const c = dao.findCollectionByNameOrId("cvdiag_raw_byte_samples");
      dao.deleteCollection(c);
    } catch {
      // Already absent.
    }
  },
);
