/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const c = new Collection({
      name: "alert_state",
      type: "base",
      schema: [
        { name: "rule_id", type: "text", required: true },
        { name: "dedupe_key", type: "text", required: true },
        { name: "last_alert_at", type: "date" },
        { name: "last_alert_hash", type: "text" },
        { name: "payload_preview", type: "text", options: { max: 500 } },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_alert_state_key ON alert_state (rule_id, dedupe_key)",
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("alert_state");
    dao.deleteCollection(c);
  },
);
