/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const c = new Collection({
      name: "status_history",
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
        {
          name: "transition",
          type: "select",
          required: true,
          options: {
            values: [
              "first",
              "green_to_red",
              "red_to_green",
              "sustained_red",
              "sustained_green",
              "error",
            ],
            maxSelect: 1,
          },
        },
        { name: "signal", type: "json" },
        { name: "observed_at", type: "date", required: true },
      ],
      indexes: [
        "CREATE INDEX idx_sh_key_observed ON status_history (key, observed_at DESC)",
        "CREATE INDEX idx_sh_dimension_observed ON status_history (dimension, observed_at DESC)",
        "CREATE INDEX idx_sh_transition ON status_history (transition) WHERE transition != 'sustained_green'",
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
    const c = dao.findCollectionByNameOrId("status_history");
    dao.deleteCollection(c);
  },
);
