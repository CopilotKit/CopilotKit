/// <reference path="../pb_data/types.d.ts" />
//
// DURABLE forensic history of the harness's OS resource gauges around the
// long-lived chromium BrowserPool. One row per snapshot, written best-effort
// by `resource-snapshot-writer.ts` — periodically (heartbeat) and on every
// significant pool transition (degraded, unrecoverable, launch-fail, crash).
//
// WHY this collection exists (and is NOT just stdout logging): the
// browser-pool wedge (#5185/#5221/#5225) ENDS in a container restart that
// clears anything in-memory, and Railway's stdout log window is capped and
// rolls off — a prior investigation hit exactly that and lost the forensic
// trail. Persisting the gauge history to PocketBase makes it survive the
// restart so the PID/thread-ceiling exhaustion (`pids.current` near
// `pids.max`) is reconstructable AFTER the wedge.
//
// RETENTION: this collection is append-only and could grow unbounded under the
// ~45s heartbeat (DEFAULT_HEARTBEAT_MS in browser-pool.ts) plus a row per
// transition (≈2k rows/day at 45s). The writer enforces a RING-STYLE cap
// (`RESOURCE_SNAPSHOT_MAX_ROWS`, default 5000 ≈ 2.5 days at 45s) — after each
// insert it prunes the oldest rows beyond the cap by stable row id (robust to
// same-millisecond `observed_at` ties), ordered via the
// `idx_resource_snapshots_observed` index. Simpler than a TTL cron and bounds
// the volume deterministically regardless of restart cadence.
//
// NULL-VS-UNAVAILABLE CONVENTION: every number field below is NULLABLE on
// purpose. The gauges degrade to a `-1` "unavailable" sentinel off-Linux / on
// an unreadable cgroup-pids / fd / df read; the writer maps that sentinel to
// `null` here (never writes `-1`), so a post-wedge query can cleanly separate a
// MEASURED reading from an UNAVAILABLE one — a stored `-1` would be
// indistinguishable from a genuine count.
//
// PUBLIC-READ INVARIANT: mirrors `status` / `probe_runs` — listRule/viewRule =
// "" (unauthenticated read) so the dashboard / a /debug endpoint can pull the
// recent history without a session. The gauge fields are pure OS counters
// (PID counts, thread/proc/zombie counts, FD/RSS/shm/tmp) and the
// `per_browser` JSON is a derived breakdown — NEVER write secrets, env vars,
// or auth tokens here. Writes stay superuser-only (createRule/deleteRule =
// null) so only the harness can mint/prune rows.
migrate(
  (db) => {
    const dao = new Dao(db);
    // Idempotency: re-running after a partial apply must be a no-op. PB JSVM
    // exposes no typed error discrimination, so catch broadly and skip when
    // the collection already exists (mirrors 1777165230_create_probe_runs).
    try {
      dao.findCollectionByNameOrId("resource_snapshots");
      return;
    } catch {
      // Not present — fall through to create.
    }
    const c = new Collection({
      name: "resource_snapshots",
      type: "base",
      schema: [
        // ISO timestamp of the sample. Indexed DESC for "last N snapshots"
        // lookback and used as the retention prune key.
        { name: "observed_at", type: "date", required: true },
        // Pool lifecycle event that triggered the snapshot
        // (`heartbeat`, `degraded`, `unrecoverable`, `launch-fail`,
        // `crash`, ...). Free-text so the writer can add events without a
        // schema migration; the headline transitions are documented in
        // browser-pool.ts.
        { name: "event", type: "text", required: true },
        // --- Headline cgroup PID-ceiling gauges (the PROVEN wedge signal) ---
        { name: "pids_current", type: "number" },
        { name: "pids_max", type: "number" },
        { name: "threads", type: "number" },
        { name: "procs", type: "number" },
        { name: "zombies", type: "number" },
        // --- Refuted-candidate differential (kept observable) ---
        { name: "fd_count", type: "number" },
        { name: "rss_mb", type: "number" },
        { name: "shm_pct", type: "number" },
        { name: "tmp_inode_pct", type: "number" },
        // --- Pool capacity at the moment of the sample ---
        { name: "browsers", type: "number" },
        { name: "contexts_in_use", type: "number" },
        { name: "contexts_available", type: "number" },
        // Optional per-browser breakdown (live contexts / served / state).
        // 64KB ceiling — the realistic shape is a handful of small objects;
        // keep the budget close to the max given the public listRule.
        { name: "per_browser", type: "json", options: { maxSize: 65536 } },
      ],
      indexes: [
        // Primary lookback + retention-prune key: newest-first by sample time.
        "CREATE INDEX IF NOT EXISTS idx_resource_snapshots_observed ON resource_snapshots (observed_at DESC)",
        // Event-scoped lookback ("show me every unrecoverable snapshot").
        "CREATE INDEX IF NOT EXISTS idx_resource_snapshots_event ON resource_snapshots (event, observed_at DESC)",
      ],
      // Public read mirrors `status` / `probe_runs`; writes superuser-only.
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
    let c;
    try {
      c = dao.findCollectionByNameOrId("resource_snapshots");
    } catch {
      // Already absent — nothing to do.
      return;
    }
    dao.deleteCollection(c);
  },
);
