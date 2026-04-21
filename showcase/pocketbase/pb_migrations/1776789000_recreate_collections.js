/// <reference path="../pb_data/types.d.ts" />
// Follow-up migration: the initial 174519XX migrations were recorded as
// applied before the `status`/`status_history`/`alert_state` collections
// were manually recreated with corrected schemas (signal JSON field needs
// explicit `options.maxSize` — otherwise PB 0.22 defaults to 0 bytes and
// rejects every write). Earlier revisions of this migration used a naive
// `maybeCreate` helper that no-op'd when the collection existed; that
// left instances with broken schema fields untouched on subsequent runs.
//
// This migration introspects each collection and ONLY touches the
// broken fields (signal.maxSize == 0, fail_count.required == true) —
// idempotent and safe across both fresh volumes and legacy instances.
//
// PUBLIC-READ INVARIANT: `status` + `status_history` have
// listRule/viewRule = "" (public read). NEVER put secrets into the
// `signal` JSON blob — its contents are trivially exposable via the PB
// collection API.
migrate(
  (db) => {
    const dao = new Dao(db);

    // Desired schema specs reused for both "collection missing" (create)
    // and "collection exists with broken fields" (patch) paths.
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

    // Patch `signal` JSON field if maxSize was inherited as 0 from the
    // original init migrations (PB 0.22 default when not explicitly set).
    // Patch `fail_count` number field if required=true was baked in
    // (required + a legitimate value of 0 is asymmetric — every row
    // with zero flap-count fails validation).
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
    // HF13-E4: intentional no-op.
    //
    // The UP arm is a reconcile patch — it introspects existing `status`,
    // `status_history`, and `alert_state` collections and patches broken
    // field options (signal.maxSize=0 → 2_000_000, fail_count.required=true
    // → false). It does NOT create those collections; earlier migrations
    // (1745193600/700/800) own their creation.
    //
    // The prior DOWN arm deleted all three collections, which would
    // cascade-destroy production data owned by those earlier migrations on
    // any partial rollback through this revision. Reverting field-level
    // reconciliation without prior-state tracking is not possible — we
    // cannot know what `maxSize`/`required` values to restore. Safer to
    // treat this migration as structurally inert on DOWN.
    //
    // Second arg preserved so the migrate() signature (up, down) stays
    // intact for PB's migration runner.
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    void db;
  },
);
