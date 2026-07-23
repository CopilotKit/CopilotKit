/// <reference path="../pb_data/types.d.ts" />
//
// Fleet worker REGISTRY: one row per live worker process. Each worker
// self-registers on boot and heartbeats on a ~60-90s cadence (see harness
// src/fleet/worker/registration.ts), refreshing its capacity + liveness. The
// control-plane / fleet-health slot (S10) reads this collection to answer "who
// is in the fleet, how busy are they, and which ones have gone stale?".
//
// DISTINCT from the other fleet collections:
//   - `probe_jobs`  : the work QUEUE the workers race over (S0).
//   - `probe_runs`  : run-level history.
//   - `status`/`status_history` : per-result state machine.
//   - `workers`     : the MEMBERSHIP roster + per-member capacity/liveness.
//
// Field semantics (mirrored in harness src/fleet/contracts.ts —
// WorkerRegistration / WorkerHeartbeat / WorkerDescriptor):
//   - worker_id         : stable worker id; SAME value the worker passes to S0's
//                         claimJob(jobId, workerId, ...) so this row and a
//                         claim's `claimed_by` join on one value. UNIQUE.
//   - endpoint          : worker's reachable host:port for control-plane probes.
//   - capacity_*        : the BrowserPool.budget() snapshot (S6) at the last
//                         register/heartbeat: in_use / available / max context
//                         counts plus the cgroup pids.current / pids.max
//                         ceiling gauges (-1 when off-Linux/unreadable).
//   - current_job_id    : id of the job the worker is running, or empty/idle.
//   - registered_at     : ISO timestamp the worker first registered.
//   - last_heartbeat_at : ISO timestamp of the latest heartbeat. fleet-health
//                         (S10) reads THIS against a staleness window to derive
//                         online | stale | offline (see isWorkerStale). Indexed
//                         DESC for "freshest workers first" + the staleness scan.
//
// ── CAPACITY / PIDS NULL-VS-UNAVAILABLE CONVENTION ────────────────────────
// `capacity_pids_current` / `capacity_pids_max` are NULLABLE: the cgroup pids
// gauges degrade to a `-1` sentinel off-Linux / on an unreadable controller
// (see browser-pool.ts budget()). The registration writer maps that sentinel to
// `null` (never writes -1), so a fleet-health query can cleanly separate a
// MEASURED pids ceiling from an UNAVAILABLE one — a stored `-1` would be
// indistinguishable from a genuine count.
//
// PUBLIC-READ INVARIANT: mirrors `status` / `probe_runs` /
// `resource_snapshots` — listRule/viewRule = "" (unauthenticated read) so the
// dashboard / fleet-health can enumerate the roster without a session. The
// fields are pure operational metadata (id, endpoint, capacity counts,
// timestamps) — NEVER write secrets, env vars, or auth tokens here. Writes stay
// superuser-only (createRule/updateRule/deleteRule = null) so only the harness
// (authed as superuser) can mint/refresh/evict rows.
migrate(
  (db) => {
    const dao = new Dao(db);
    // Idempotency: skip when the collection already exists (mirrors the
    // probe_jobs / probe_runs presence-gate pattern). PB JSVM has no typed
    // ErrCollectionNotFound, so catch broadly and return on present.
    try {
      dao.findCollectionByNameOrId("workers");
      return;
    } catch (e) {
      // Not present — fall through to create.
    }
    const c = new Collection({
      name: "workers",
      type: "base",
      schema: [
        { name: "worker_id", type: "text", required: true },
        { name: "endpoint", type: "text", required: true },
        // --- Capacity snapshot (BrowserPool.budget()) ---
        { name: "capacity_in_use", type: "number" },
        { name: "capacity_available", type: "number" },
        { name: "capacity_max", type: "number" },
        // Nullable cgroup pids gauges: -1 sentinel maps to null (see header).
        { name: "capacity_pids_current", type: "number" },
        { name: "capacity_pids_max", type: "number" },
        // Id of the job the worker is currently running, empty while idle.
        { name: "current_job_id", type: "text" },
        { name: "registered_at", type: "date", required: true },
        { name: "last_heartbeat_at", type: "date", required: true },
      ],
      indexes: [
        // One row per worker: the upsert-by-worker_id path and the
        // join-to-claimed_by both rely on worker_id being unique.
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_workers_worker_id ON workers (worker_id)",
        // fleet-health (S10) staleness scan + "freshest workers first".
        "CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON workers (last_heartbeat_at DESC)",
      ],
      // Public read mirrors status / probe_runs / resource_snapshots; writes
      // superuser-only (the harness authenticates as a superuser).
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
    // Narrowed: a real deleteCollection failure must propagate. Absent →
    // nothing to do.
    let c;
    try {
      c = dao.findCollectionByNameOrId("workers");
    } catch (e) {
      return;
    }
    dao.deleteCollection(c);
  },
);
