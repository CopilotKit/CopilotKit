/// <reference path="../pb_data/types.d.ts" />
//
// DURABLE, HTTP-readable forensic trail of CVDIAG diagnostic events for the
// context-value (CV) propagation incident. One row per CVDIAG event, written
// best-effort by `diag-sink.ts` at each instrumented boundary (inbound,
// als-snapshot, configurable-read, contextvar-capture, outbound-llm,
// fixture-match, cv-verdict).
//
// WHY this collection exists (and is NOT just stdout logging): the
// CV-propagation bug is diagnosed MID-INCIDENT, and Railway's stdout log
// window is capped and rolls off — a prior investigation lost its trail
// exactly that way. Persisting each CVDIAG event to PocketBase makes the
// per-request propagation chain reconstructable (and pullable over plain HTTP)
// while the incident is still live. The load-bearing signal is
// `header_present=false`: the hop where the `x-aimock-context` slug went
// MISSING localizes the drop.
//
// PUBLIC-READ INVARIANT: mirrors `status` / `probe_runs` / `resource_snapshots`
// — listRule/viewRule = "" (unauthenticated read) so the dashboard or a /debug
// endpoint can pull recent events without a session DURING an incident. The
// fields are pure diagnostic metadata (slug, framework, boundary, status,
// hop breadcrumb) and `diag-sink.ts` redacts header values upstream — NEVER
// write secrets, env vars, or auth tokens here. Writes are LEFT OPEN
// (createRule/updateRule = "") because this is an internal staging tool and
// the harness writes anonymously; deletes are superuser-only so an anonymous
// caller can't wipe the trail mid-incident.
migrate(
  (db) => {
    const dao = new Dao(db);
    // Idempotency: re-running after a partial apply must be a no-op. PB JSVM
    // exposes no typed error discrimination, so catch broadly and skip when
    // the collection already exists (mirrors 1779989300_create_resource_snapshots).
    try {
      dao.findCollectionByNameOrId("diag_events");
      return;
    } catch {
      // Not present — fall through to create.
    }
    const c = new Collection({
      name: "diag_events",
      type: "base",
      schema: [
        // Per-trace correlation id (x-diag-run-id). Indexed for "show me every
        // hop of this one request" lookback.
        { name: "run_id", type: "text", required: true },
        // The x-aimock-context routing slug observed at this boundary
        // ("MISSING" when the header was absent — header_present carries the
        // boolean form of the same signal).
        { name: "slug", type: "text" },
        // Framework / app the boundary belongs to (free-text).
        { name: "framework", type: "text" },
        // Emitting component (module / driver / boundary owner).
        { name: "component", type: "text" },
        // Which boundary in the propagation chain (inbound, als-snapshot,
        // configurable-read, contextvar-capture, outbound-llm, fixture-match,
        // cv-verdict). Free-text so slots can add boundaries without a schema
        // migration.
        { name: "boundary", type: "text" },
        // The load-bearing signal: was x-aimock-context present at this hop?
        { name: "header_present", type: "bool" },
        // Per-boundary outcome (ok, miss, error). Free-text.
        { name: "status", type: "text" },
        // Comma-joined breadcrumb of boundaries already crossed (x-diag-hops).
        { name: "hops", type: "text" },
        // The x-test-id header for this request, if present.
        { name: "test_id", type: "text" },
        // Short error summary on the error path (never a full stack/payload).
        { name: "error", type: "text" },
      ],
      indexes: [
        // Primary lookback: every hop of one request, newest-first.
        "CREATE INDEX IF NOT EXISTS idx_diag_events_run_id ON diag_events (run_id, created DESC)",
        // Cross-request lookback ("show me every boundary that went missing").
        "CREATE INDEX IF NOT EXISTS idx_diag_events_boundary ON diag_events (boundary, created DESC)",
      ],
      // Public read mirrors status/probe_runs/resource_snapshots. Writes are
      // open (internal staging tool, anonymous harness writes); deletes are
      // superuser-only so the trail can't be wiped anonymously mid-incident.
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: null,
    });
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    let c;
    try {
      c = dao.findCollectionByNameOrId("diag_events");
    } catch {
      // Already absent — nothing to do.
      return;
    }
    dao.deleteCollection(c);
  },
);
