/// <reference path="../pb_data/types.d.ts" />
//
// PUBLIC-READ INVARIANT: `status` is served with listRule/viewRule = ""
// (unauthenticated read). NEVER put secrets into the `signal` JSON blob
// — any value stored here is trivially exposable via the PB collection
// API from any browser. Sanitize at the writer (see status-writer.ts)
// before anything reaches this collection.
migrate(
  (db) => {
    const dao = new Dao(db);
    // Idempotency: on an existing volume the `status` collection may
    // already exist while this migration is NOT recorded in `_migrations`.
    // A bare saveCollection(new Collection(...)) then throws
    // `UNIQUE constraint failed: _collections.name`, aborting the entire
    // migration chain. Mirror the proven probe_runs / resource_snapshots
    // guard: find-or-skip. PB JSVM has no typed error discrimination, so
    // catch broadly and treat a present collection as a clean no-op.
    // (The later 1776789000/100 reconcile migrations own field-level
    // schema corrections for an existing `status`.)
    try {
      dao.findCollectionByNameOrId("status");
      return;
    } catch {
      // Not present — fall through to create.
    }
    const c = new Collection({
      name: "status",
      type: "base",
      schema: [
        { name: "key", type: "text", required: true },
        { name: "dimension", type: "text", required: true },
        {
          name: "state",
          type: "select",
          required: true,
          options: { values: ["green", "red", "degraded"], maxSelect: 1 },
        },
        { name: "signal", type: "json", options: { maxSize: 2000000 } },
        { name: "observed_at", type: "date", required: true },
        { name: "transitioned_at", type: "date", required: true },
        { name: "fail_count", type: "number" },
        { name: "first_failure_at", type: "date" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_status_key ON status (key)",
        "CREATE INDEX idx_status_dimension ON status (dimension)",
        "CREATE INDEX idx_status_state ON status (state)",
      ],
      listRule: "",
      viewRule: "",
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("status");
    } catch {
      // Already absent — nothing to do.
      return;
    }
    dao.deleteCollection(c);
  },
);
