/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
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
        { name: "fail_count", type: "number", required: true },
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
    const c = dao.findCollectionByNameOrId("status");
    dao.deleteCollection(c);
  },
);
