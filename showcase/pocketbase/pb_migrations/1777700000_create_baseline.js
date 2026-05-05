/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
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
    const c = dao.findCollectionByNameOrId("baseline");
    dao.deleteCollection(c);
  },
);
