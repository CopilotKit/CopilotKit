/// <reference path="../pb_data/types.d.ts" />
//
// Per-invocation probe run history. One row per probe invocation,
// inserted by the probe-invoker on tick start and finalized on tick
// completion. Distinct from `status` / `status_history` (per-result
// state machine) — this collection captures run-level metadata
// (duration, triggered-vs-scheduled, pass/fail counts) for the dashboard's
// "last N runs" widget.
//
// PUBLIC-READ INVARIANT: the `summary` JSON field is exposed via the
// listRule below. NEVER write secrets, env vars, or auth tokens into
// `summary` — sanitize at the writer (see run-history.ts) before
// anything reaches this collection.
//
// Field semantics (mirrored in run-history.ts ProbeRunRecord):
//   - probe_id   : string id matching the probe YAML's `id` field.
//   - started_at : ISO timestamp; row inserted at this time with
//                  state='running' and finished_at=null.
//   - finished_at: ISO timestamp; null while inflight, set on completion.
//   - duration_ms: derived from finished_at - started_at; null while
//                  inflight.
//   - triggered  : true when the run was kicked off ad-hoc (Slack /
//                  webhook), false when it came from the cron scheduler.
//   - state      : 'running' | 'completed' | 'failed' — narrower than
//                  the per-result State enum because run-level health is
//                  binary (the run either finished or it didn't).
//   - summary    : JSON blob `{ total, passed, failed, services? }` for
//                  the dashboard rollup.
migrate(
  (db) => {
    const dao = new Dao(db);
    // Idempotency: re-running the migration after a partial apply (the
    // exact failure mode that motivated the 1776789100 reconcile pattern)
    // must be a no-op. Skip when the collection already exists.
    //
    // R2-A.11: PB JSVM does NOT expose typed error discrimination
    // (no ErrCollectionNotFound), so we have to catch broadly here.
    // The cost is low: a real permission/IO error against the dao
    // would fall through to createCollection, which would surface its
    // own error. The down-migration is narrowed (it operates on a
    // resolved-or-skip path).
    try {
      dao.findCollectionByNameOrId("probe_runs");
      return;
    } catch (e) {
      // Not present (or PB JSVM threw something equivalent) — fall
      // through to create. We can't tighten further without typed
      // errors from the runtime.
    }
    const c = new Collection({
      name: "probe_runs",
      type: "base",
      schema: [
        { name: "probe_id", type: "text", required: true },
        { name: "started_at", type: "date", required: true },
        { name: "finished_at", type: "date" },
        // CR-A1.6: reject negative durations from clock skew. PB
        // numeric fields support a `min` constraint that fails inserts
        // outside the bound — surfaces the bug at the writer rather
        // than letting nonsense durations propagate to dashboards.
        { name: "duration_ms", type: "number", options: { min: 0 } },
        {
          name: "triggered",
          // CR-A1.6: writer always sets this (running rows pass true|false
          // explicitly), so the schema should match the contract. Marking
          // required:true makes a forgetful caller fail at insert time.
          type: "bool",
          required: true,
        },
        // CR-A1.6: tighten maxSize from 2MB to 64KB. The summary shape
        // is `{total, passed, failed, services?}` — well under 64KB.
        // The 2MB ceiling was an exfiltration sink given the public
        // listRule below; keep the budget close to the realistic max.
        { name: "summary", type: "json", options: { maxSize: 65536 } },
        {
          name: "state",
          type: "select",
          required: true,
          options: {
            values: ["running", "completed", "failed"],
            maxSelect: 1,
          },
        },
      ],
      indexes: [
        // Per-probe descending — primary lookup pattern is "last N runs
        // for probe X", served directly by this composite index without
        // a sort step. Mirrors the status_history pattern in
        // 1776789000.
        //
        // R2-A.11: IF NOT EXISTS so a partial-apply on the indexes step
        // doesn't trip the next migration run. The collection-presence
        // gate above already covers the saveCollection idempotency; this
        // covers the per-index path in case PB ever runs index DDL
        // separately from the schema commit.
        "CREATE INDEX IF NOT EXISTS idx_probe_runs_probe_started ON probe_runs (probe_id, started_at DESC)",
        // Standalone started_at index covers cross-probe time-range
        // queries (retention sweeps, "last 24h across all probes").
        "CREATE INDEX IF NOT EXISTS idx_probe_runs_started ON probe_runs (started_at DESC)",
      ],
      // Public read mirrors `status` / `status_history` — the dashboard
      // pulls run history without an authenticated session. Writes stay
      // superuser-only (createRule/updateRule/deleteRule = null) so only
      // the probe-invoker can mint rows.
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
    // CR-A1.6: narrow the catch to `findCollectionByNameOrId` only.
    // A real `deleteCollection` failure (FK constraint, permission,
    // etc.) must propagate so the migration framework can roll back —
    // swallowing here would leave a half-deleted collection live in PB
    // and look like a clean down-migration to the operator.
    let c;
    try {
      c = dao.findCollectionByNameOrId("probe_runs");
    } catch (e) {
      // Already absent — nothing to do.
      return;
    }
    dao.deleteCollection(c);
  },
);
