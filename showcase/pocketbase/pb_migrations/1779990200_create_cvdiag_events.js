/// <reference path="../pb_data/types.d.ts" />
//
// PERMANENT cross-layer flap-observability telemetry: one row per CVDIAG
// event emitted at an instrumented boundary across the probe → backend →
// aimock pipeline. This is the durable, queryable correlation store the
// flap-classifier (bin/showcase cvdiag --classify) reads to discriminate the
// eight d4 "empty assistant response" root-cause classes. See
// showcase/harness/src/cvdiag/ + the flap-observability spec §4/§5.
//
// RELATIONSHIP TO diag_events (1779990100): this is a SEPARATE collection.
// `diag_events` is the older, anonymously-readable CVDIAG header-forwarding
// trail (written by diag-sink.ts) and is LEFT ENTIRELY UNTOUCHED here.
// `cvdiag_events` carries a richer 15-field envelope (schema_version,
// span/trace ids, edge_headers, typed metadata) and a STRICTER ACL: it is
// NOT anonymously readable, and writes are split across three role-keyed
// API identities so a stolen writer key cannot rewrite or wipe history.
//
// THREE-KEY ACL (see cvdiag_api_keys auth collection below):
//   - writer  : CREATE only — used by all CVDIAG emitters.
//   - purge   : DELETE only — used by `bin/showcase cvdiag --purge*` (ops).
//   - migration: schema_version backfill ONLY — runs ADMIN-side inside the
//     migration JS (Dao/save), which bypasses collection rules. API UPDATEs
//     are FORBIDDEN for everyone (updateRule=null): PB rules are record-level
//     (no field-level restriction), so a who-only updateRule would let the
//     migration key PATCH ANY field and rewrite history. The cvdiag code
//     NEVER updates via the API.
// The PocketBase SUPERUSER bypasses ALL collection rules, so the role split
// is only observable when the caller authenticates as a role-keyed
// cvdiag_api_keys record (NOT as a superuser). list/view require auth —
// anonymous GET returns 401/403.
migrate(
  (db) => {
    const dao = new Dao(db);

    // ---- Auth collection holding the three role-keyed API identities ----
    // Each emitter / operator authenticates as one of these records; its
    // `role` field is what the cvdiag_events rules key on. This is a normal
    // PB auth collection (like `users`) — NOT a superuser. Idempotent:
    // skip creation if it already exists from a prior partial apply.
    let apiKeys;
    try {
      apiKeys = dao.findCollectionByNameOrId("cvdiag_api_keys");
    } catch {
      apiKeys = new Collection({
        name: "cvdiag_api_keys",
        type: "auth",
        // Auth records are managed by the superuser / migrations only —
        // never self-service. Lock down every anonymous-capable rule.
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        options: {
          allowEmailAuth: true,
          allowUsernameAuth: false,
          allowOAuth2Auth: false,
          requireEmail: true,
          minPasswordLength: 8,
          onlyVerified: false,
        },
        schema: [
          // The role this identity is authorized for: writer | purge |
          // migration. cvdiag_events rules compare against this field.
          {
            name: "role",
            type: "select",
            required: true,
            options: {
              values: ["writer", "purge", "migration"],
              maxSelect: 1,
            },
          },
        ],
      });
      dao.saveCollection(apiKeys);
    }

    // Seed the three role records so a fresh instance (and the ACL
    // regression test) has the writer/purge/migration identities present.
    // Passwords here are NON-SECRET bootstrap defaults for local/staging
    // dev + tests; production rotates them out-of-band via the runbook.
    // Real secrets are NEVER committed — these only gate a non-anonymous,
    // role-split-only-observable internal telemetry collection.
    const seedKey = (email, password, role) => {
      // findFirstRecordByData THROWS "no rows in result set" (it does not
      // return null) when the record is absent — treat that as "not seeded
      // yet" and fall through to create. An already-present record is a
      // no-op (idempotent re-apply).
      try {
        dao.findFirstRecordByData("cvdiag_api_keys", "email", email);
        return;
      } catch {
        // Not present — create it below.
      }
      const rec = new Record(apiKeys, { role });
      // PB auth records carry a NOT-NULL, unique username column even when
      // username auth is disabled — derive a stable one from the role.
      rec.setUsername(`cvdiag_${role}`);
      rec.setEmail(email);
      rec.setVerified(true);
      rec.setPassword(password);
      dao.saveRecord(rec);
    };
    seedKey("cvdiag-writer@keys.local", "cvdiagwriterpass123", "writer");
    seedKey("cvdiag-purge@keys.local", "cvdiagpurgepass123", "purge");
    seedKey(
      "cvdiag-migration@keys.local",
      "cvdiagmigrationpass123",
      "migration",
    );

    // ---- The cvdiag_events collection ----
    // Idempotency: re-running after a partial apply is a no-op (mirrors
    // 1779990100). PB JSVM exposes no typed error discrimination, so catch
    // broadly and skip when the collection already exists.
    try {
      dao.findCollectionByNameOrId("cvdiag_events");
      return;
    } catch {
      // Not present — fall through to create.
    }

    const c = new Collection({
      name: "cvdiag_events",
      type: "base",
      schema: [
        // Envelope schema version. Migration-key UPDATEs target this field
        // for backfill; additive-minor bumps stay consumer-compatible.
        { name: "schema_version", type: "number", required: true },
        // UUIDv7 correlation key — the single id that joins one probe's
        // events across all layers. Indexed (primary lookup).
        { name: "test_id", type: "text", required: true },
        // OTel-aligned tracing ids for call-tree reconstruction.
        { name: "trace_id", type: "text" },
        { name: "span_id", type: "text" },
        { name: "parent_span_id", type: "text" },
        // Emitting layer: probe | backend | aimock (free-text; schema.ts
        // owns the closed enum, validated at emit time).
        { name: "layer", type: "text" },
        // The named boundary (closed enum in schema.ts; free-text here so
        // new boundaries don't need a PB migration).
        { name: "boundary", type: "text" },
        // Showcase integration slug + demo this event belongs to.
        { name: "slug", type: "text" },
        { name: "demo", type: "text" },
        // ISO-8601 wall-clock timestamp (ms precision, Z suffix). Indexed
        // for time-series scans.
        { name: "ts", type: "text", required: true },
        // Emitter-local monotonic ns timestamp for within-layer ordering.
        { name: "mono_ns", type: "number" },
        // Boundary duration (null = boundary does not measure duration).
        { name: "duration_ms", type: "number" },
        // ok | err | timeout | info.
        { name: "outcome", type: "text" },
        // Closed 9-key edge-header capture (Cloudflare / Railway / proxy).
        { name: "edge_headers", type: "json", options: { maxSize: 8000 } },
        // Per-boundary typed metadata blob.
        { name: "metadata", type: "json", options: { maxSize: 16000 } },
      ],
      indexes: [
        // Primary correlation lookup: every event for one test, newest-first.
        "CREATE INDEX IF NOT EXISTS idx_cvdiag_events_test_id ON cvdiag_events (test_id, ts DESC)",
        // Time-series scans.
        "CREATE INDEX IF NOT EXISTS idx_cvdiag_events_ts ON cvdiag_events (ts)",
        // Per-slug per-layer drilldown.
        "CREATE INDEX IF NOT EXISTS idx_cvdiag_events_slug_layer_ts ON cvdiag_events (slug, layer, ts)",
        // Consumer-version slicing.
        "CREATE INDEX IF NOT EXISTS idx_cvdiag_events_schema_version_ts ON cvdiag_events (schema_version, ts)",
      ],
      // list/view = null → superuser-ONLY read; anonymous GET returns
      // 401/403 (NOT an empty 200). This is deliberate over a
      // `@request.auth.id != ""` filter rule: in PocketBase a non-null
      // filter rule never rejects an anonymous caller — it just returns an
      // empty 200, which fails the spec's hard "anon GET MUST 401/403"
      // invariant. The three role keys are WRITE-only by design
      // (writer/purge/migration never read); the dashboard + `bin/showcase
      // cvdiag` CLI read via the superuser, which bypasses rules. So
      // locking reads to superuser matches the real access pattern AND
      // yields the required anonymous rejection. Unlike diag_events, this
      // collection is NOT publicly readable — the richer envelope + edge
      // headers warrant the stricter posture.
      listRule: null,
      viewRule: null,
      // Write split keyed on the authenticated identity's role.
      // CREATE = writer; DELETE = purge. A stolen writer key
      // (role="writer") satisfies only createRule, so it cannot rewrite
      // (UPDATE) or wipe (DELETE) history.
      createRule:
        '@request.auth.collectionName = "cvdiag_api_keys" && @request.auth.role = "writer"',
      // updateRule = null → ALL API UPDATEs are forbidden (history is
      // immutable). PB rules are record-level with no field-level
      // restriction, so a who-only updateRule would let the migration key
      // PATCH ANY field and rewrite history — the exact thing this ACL
      // exists to prevent. The schema_version backfill runs ADMIN-side
      // inside the migration JS (Dao/save), which bypasses collection
      // rules, so it is UNAFFECTED by this null rule.
      updateRule: null,
      deleteRule:
        '@request.auth.collectionName = "cvdiag_api_keys" && @request.auth.role = "purge"',
    });
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    // Down: drop cvdiag_events first, then the api-keys auth collection.
    try {
      const c = dao.findCollectionByNameOrId("cvdiag_events");
      dao.deleteCollection(c);
    } catch {
      // Already absent.
    }
    try {
      const k = dao.findCollectionByNameOrId("cvdiag_api_keys");
      dao.deleteCollection(k);
    } catch {
      // Already absent.
    }
  },
);
