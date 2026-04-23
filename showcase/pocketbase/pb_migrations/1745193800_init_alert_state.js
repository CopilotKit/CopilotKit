/// <reference path="../pb_data/types.d.ts" />
//
// AUTHENTICATED-READ INVARIANT: `alert_state` has
// listRule/viewRule = '@request.auth.id != ""' — only authenticated
// operators can read. Still, treat `payload_preview` as PR-safe:
// dedupe hashes, rule ids, timestamps only. Alerts can leak into this
// preview if future code ever widens what's stored; keep the field
// scrubbed at the writer.
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
