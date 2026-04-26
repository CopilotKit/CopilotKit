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
    try {
      dao.findCollectionByNameOrId("probe_runs");
      return;
    } catch (e) {
      // Not present — fall through to create.
    }
    const c = new Collection({
      name: "probe_runs",
      type: "base",
      schema: [
        { name: "probe_id", type: "text", required: true },
        { name: "started_at", type: "date", required: true },
        { name: "finished_at", type: "date" },
        { name: "duration_ms", type: "number" },
        {
          name: "triggered",
          type: "bool",
          required: false,
        },
        { name: "summary", type: "json", options: { maxSize: 2000000 } },
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
        "CREATE INDEX idx_probe_runs_probe_started ON probe_runs (probe_id, started_at DESC)",
        // Standalone started_at index covers cross-probe time-range
        // queries (retention sweeps, "last 24h across all probes").
        "CREATE INDEX idx_probe_runs_started ON probe_runs (started_at DESC)",
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
    // Best-effort drop. If the collection isn't present (rolled back on
    // a partial apply), short-circuit cleanly so down-migrations stay
    // idempotent — same pattern as 1776789200_drop_history_fail_count.
    try {
      const c = dao.findCollectionByNameOrId("probe_runs");
      dao.deleteCollection(c);
    } catch (e) {
      // Already absent — nothing to do.
    }
  },
);
