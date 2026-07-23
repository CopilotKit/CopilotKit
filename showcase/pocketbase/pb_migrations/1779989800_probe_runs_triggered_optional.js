/// <reference path="../pb_data/types.d.ts" />
//
// Make `probe_runs.triggered` OPTIONAL (not required).
//
// The S5 fleet aggregator (harness src/fleet/control-plane/result-aggregator.ts)
// opens a run-history row for every fleet run with `triggered: false` — a
// fleet run is driven by the producer's cron cadence, never an ad-hoc
// Slack/webhook trigger. But `1777165230_create_probe_runs.js` shaped the
// `triggered` column as `bool, required: true`, and PocketBase's `required`
// validation rejects the boolean `false` (it is treated as "empty") with a
// `validation_required` error. The result: the aggregator's run-history
// `start()` fails on EVERY scheduled (non-triggered) run. Status cells still
// land (run-history is best-effort), but run-history itself is broken for
// scheduled runs — the dashboard's "last N runs" widget never records them.
//
// The legacy in-process probe-invoker writes `triggered: true` for ad-hoc
// runs and `false` for scheduled ones too, so this also un-breaks scheduled
// run-history on the existing deployed schema (the create migration above has
// already run on staging/prod volumes — see the #5242-fixed chain — so we
// ALTER the field on the live collection rather than recreating it).
//
// `triggered: false` is the correct semantic default: a run is "scheduled"
// unless something explicitly marks it as ad-hoc-triggered.
//
// Additive + idempotent: a presence/already-optional check makes a re-run
// after a partial apply a no-op (mirrors the field-presence gates in the
// other fleet migrations). The down migration restores `required: true`.
migrate(
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_runs");
    } catch (e) {
      // The base collection isn't present yet — nothing to alter. The
      // create migration (lower unix prefix) runs first; if it somehow
      // hasn't, this is a no-op rather than a hard failure.
      return;
    }
    const field = c.schema.getFieldByName("triggered");
    if (!field) {
      // Field gone (renamed/dropped by a future migration) — nothing to do.
      return;
    }
    // Idempotency: already optional → no-op.
    if (field.required === false) {
      return;
    }
    field.required = false;
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_runs");
    } catch (e) {
      return;
    }
    const field = c.schema.getFieldByName("triggered");
    if (!field) {
      return;
    }
    if (field.required === true) {
      return;
    }
    field.required = true;
    dao.saveCollection(c);
  },
);
