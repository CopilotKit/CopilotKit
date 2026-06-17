/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    // Idempotency: on an existing volume the `baseline` collection may
    // already exist while this migration is NOT recorded in `_migrations`
    // (e.g. staging volumes pre-dating consistent migration tracking).
    // A bare saveCollection(new Collection(...)) then throws
    // `UNIQUE constraint failed: _collections.name`, which aborts the
    // ENTIRE migration chain before later migrations can run. Mirror the
    // proven probe_runs / resource_snapshots guard: find-or-skip. PB JSVM
    // exposes no typed error discrimination, so catch broadly and treat a
    // present collection as a clean no-op.
    try {
      dao.findCollectionByNameOrId("baseline");
      return;
    } catch {
      // Not present — fall through to create.
    }
    const c = new Collection({
      name: "baseline",
      type: "base",
      schema: [
        { name: "key", type: "text", required: true },
        { name: "partner", type: "text", required: true },
        { name: "feature", type: "text", required: true },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            values: ["works", "possible", "impossible", "unknown"],
            maxSelect: 1,
          },
        },
        { name: "tags", type: "json", options: { maxSize: 500 } },
        { name: "updated_at", type: "date", required: true },
        { name: "updated_by", type: "text" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_baseline_key ON baseline (key)",
        "CREATE INDEX idx_baseline_partner ON baseline (partner)",
        "CREATE INDEX idx_baseline_feature ON baseline (feature)",
      ],
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: null,
    });
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("baseline");
    } catch {
      // Already absent — nothing to do.
      return;
    }
    dao.deleteCollection(c);
  },
);
