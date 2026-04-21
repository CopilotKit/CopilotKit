/// <reference path="../pb_data/types.d.ts" />
// Follow-up to 1776789000: kept as a second-pass reconcile so instances
// that applied the earlier (naive-maybeCreate) revision of 1776789000
// still converge on the correct schema. This migration runs the same
// introspection logic — safe to apply even after 1776789000 has already
// fixed everything (it's a no-op in that case).
//
// PUBLIC-READ INVARIANT: `status` + `status_history` have
// listRule/viewRule = "" (public read). NEVER put secrets into the
// `signal` JSON blob — its contents are trivially exposable via the PB
// collection API.
migrate(
  (db) => {
    const dao = new Dao(db);

    const statusSpec = {
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
    };

    const statusHistorySpec = {
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
        { name: "signal", type: "json", options: { maxSize: 2000000 } },
        { name: "observed_at", type: "date", required: true },
        { name: "fail_count", type: "number" },
      ],
      indexes: [
        "CREATE INDEX idx_sh_key_observed ON status_history (key, observed_at DESC)",
        "CREATE INDEX idx_sh_transition_partial ON status_history (key, observed_at DESC) WHERE transition != 'sustained_green'",
      ],
      listRule: "",
      viewRule: "",
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };

    const alertStateSpec = {
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
    };

    const reconcile = (spec) => {
      let c;
      try {
        c = dao.findCollectionByNameOrId(spec.name);
      } catch (e) {
        dao.saveCollection(new Collection(spec));
        return;
      }
      let dirty = false;
      const signalField = c.schema.getFieldByName("signal");
      if (
        signalField &&
        (!signalField.options ||
          !signalField.options.maxSize ||
          signalField.options.maxSize === 0)
      ) {
        signalField.options = Object.assign({}, signalField.options || {}, {
          maxSize: 2000000,
        });
        dirty = true;
      }
      const failCount = c.schema.getFieldByName("fail_count");
      if (failCount && failCount.required === true) {
        failCount.required = false;
        dirty = true;
      }
      if (dirty) {
        dao.saveCollection(c);
      }
    };

    reconcile(statusSpec);
    reconcile(statusHistorySpec);
    reconcile(alertStateSpec);
  },
  (db) => {
    const dao = new Dao(db);
    for (const name of ["status", "status_history", "alert_state"]) {
      try {
        const c = dao.findCollectionByNameOrId(name);
        dao.deleteCollection(c);
      } catch (e) {
        // ignore if already gone
      }
    }
  },
);
