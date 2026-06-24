import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPbClient, PbHttpError } from "../storage/pb-client.js";
import type { ListOpts, ListResult } from "../storage/pb-client.js";
import { logger } from "../logger.js";
import {
  CvdiagPbWriter,
  CVDIAG_EVENTS_COLLECTION,
  CVDIAG_RAW_BYTE_SAMPLES_COLLECTION,
} from "./pb-writer.js";
import type { CvdiagEventRecord, CvdiagWriterClient } from "./pb-writer.js";

// Real-PocketBase ACL proof for the CVDIAG observability collections.
//
// Boots an actual PocketBase 0.22 server using the EXACT production
// migrations (showcase/pocketbase/pb_migrations) — which now include the
// new cvdiag_events + cvdiag_raw_byte_samples collections + the three
// role-keyed auth records (writer / purge / migration) — then asserts the
// three-key ACL split end-to-end:
//   - anon GET on cvdiag_events returns 401/403 (auth required),
//   - the writer key can CREATE but CANNOT UPDATE or DELETE,
//   - the purge key can DELETE only,
//   - the migration key can UPDATE schema_version only,
//   - the pre-existing diag_events collection keeps its public listRule.
//
// The three keys are NON-superuser auth records: the superuser bypasses ALL
// collection rules, so a rule-level ACL split is only observable when the
// caller authenticates as a role-keyed record. This mirrors the
// superuser-bypass caveat documented in the fleet job-claim integration
// test.
//
// Requires a `pocketbase` binary. Set POCKETBASE_BIN to its path, or put it
// on PATH (or drop it at /tmp/pb022/pocketbase). The suite skips (not
// fails) when no binary is available so CI without the binary stays green.

const PB_BIN = resolvePbBinary();
const PORT = 8098;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "cvdiag-acl@test.local";
const ADMIN_PASS = "cvdiagaclpass123";

// These mirror the seed records created by the cvdiag_api_keys migration.
const WRITER_EMAIL = "cvdiag-writer@keys.local";
const WRITER_PASS = "cvdiagwriterpass123";
const PURGE_EMAIL = "cvdiag-purge@keys.local";
const PURGE_PASS = "cvdiagpurgepass123";
const MIGRATION_EMAIL = "cvdiag-migration@keys.local";
const MIGRATION_PASS = "cvdiagmigrationpass123";

const REPO_PB_DIR = resolve(__dirname, "../../../pocketbase");
const MIGRATIONS_DIR = join(REPO_PB_DIR, "pb_migrations");
const HOOKS_DIR = join(REPO_PB_DIR, "pb_hooks");

function resolvePbBinary(): string | null {
  const explicit = process.env.POCKETBASE_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  const probe = spawnSync("which", ["pocketbase"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
  if (existsSync("/tmp/pb022/pocketbase")) return "/tmp/pb022/pocketbase";
  return null;
}

async function waitForHealth(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("PocketBase did not become healthy in time");
}

async function adminToken(): Promise<string> {
  const r = await fetch(`${BASE}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  if (!r.ok) throw new Error(`admin auth: ${r.status} ${await r.text()}`);
  const body = (await r.json()) as { token: string };
  return body.token;
}

/** Authenticate as a role-keyed cvdiag_api_keys record; returns the token. */
async function keyToken(identity: string, password: string): Promise<string> {
  const r = await fetch(
    `${BASE}/api/collections/cvdiag_api_keys/auth-with-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity, password }),
    },
  );
  if (!r.ok)
    throw new Error(`key auth ${identity}: ${r.status} ${await r.text()}`);
  const body = (await r.json()) as { token: string };
  return body.token;
}

function sampleEvent(
  overrides: Partial<CvdiagEventRecord> = {},
): CvdiagEventRecord {
  return {
    schema_version: 1,
    test_id: "0190a0c0-0000-7000-8000-000000000001",
    trace_id: "0190a0c0-0000-7000-8000-000000000001",
    span_id: "0000000000000001",
    parent_span_id: null,
    layer: "probe",
    boundary: "probe.start",
    slug: "langgraph-python",
    demo: "chat",
    ts: "2026-06-18T00:00:00.000Z",
    mono_ns: 1,
    duration_ms: null,
    outcome: "info",
    edge_headers: {
      "cf-ray": null,
      "cf-mitigated": null,
      "cf-cache-status": null,
      "x-railway-edge": null,
      "x-railway-request-id": null,
      "x-hikari-trace": null,
      "retry-after": null,
      via: null,
      server: null,
    },
    metadata: { url: "https://example.test" },
    ...overrides,
  };
}

/** CREATE a cvdiag_events row directly via REST with the given bearer token. */
async function createRow(
  tok: string,
  record: CvdiagEventRecord,
): Promise<Response> {
  return fetch(`${BASE}/api/collections/cvdiag_events/records`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: tok },
    body: JSON.stringify(record),
  });
}

/**
 * CREATE a cvdiag_events row AND assert the CREATE actually succeeded (returned
 * a real id) BEFORE the caller's deny assertion runs. FIX C: the ACL deny tests
 * (writer DELETE / writer UPDATE / migration UPDATE) accept a 404 in their
 * matcher, so if the prerequisite CREATE silently fails the `id` is undefined,
 * the deny request hits `/records/undefined`, PB returns 404, and the test
 * FALSE-GREENS — "proving" a deny that never had a row to deny. Asserting a
 * non-empty id here makes the deny proof real instead of hollow.
 */
async function createRowOrThrow(
  tok: string,
  record: CvdiagEventRecord,
): Promise<string> {
  const created = await createRow(tok, record);
  expect(created.ok).toBe(true);
  const { id } = (await created.json()) as { id?: string };
  expect(id).toBeTruthy();
  return id as string;
}

/** Read a cvdiag_events row back as admin; returns null on 404. */
async function readRowAsAdmin(
  id: string,
): Promise<{ schema_version: number } | null> {
  const adminTok = await adminToken();
  const res = await fetch(
    `${BASE}/api/collections/cvdiag_events/records/${id}`,
    { headers: { authorization: adminTok } },
  );
  if (res.status === 404) return null;
  return (await res.json()) as { schema_version: number };
}

let pb: ChildProcess | undefined;
let dataDir: string | undefined;

const describeMaybe = PB_BIN ? describe : describe.skip;

describeMaybe("cvdiag pb-writer — real PocketBase 3-key ACL proof", () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "pb-cvdiag-acl-"));
    const mig = spawnSync(
      PB_BIN as string,
      [
        "migrate",
        "up",
        `--dir=${dataDir}`,
        `--migrationsDir=${MIGRATIONS_DIR}`,
      ],
      { encoding: "utf8" },
    );
    if (mig.status !== 0) {
      throw new Error(`pb migrate up failed: ${mig.stderr || mig.stdout}`);
    }
    const admin = spawnSync(
      PB_BIN as string,
      ["admin", "create", ADMIN_EMAIL, ADMIN_PASS, `--dir=${dataDir}`],
      { encoding: "utf8" },
    );
    if (admin.status !== 0) {
      throw new Error(
        `pb admin create failed: ${admin.stderr || admin.stdout}`,
      );
    }
    pb = spawn(
      PB_BIN as string,
      [
        "serve",
        `--http=127.0.0.1:${PORT}`,
        `--dir=${dataDir}`,
        `--migrationsDir=${MIGRATIONS_DIR}`,
        `--hooksDir=${HOOKS_DIR}`,
      ],
      { stdio: "ignore" },
    );
    await waitForHealth();
  }, 30_000);

  afterAll(() => {
    if (pb) pb.kill("SIGKILL");
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("anon GET on cvdiag_events is denied (401/403)", async () => {
    const list = await fetch(`${BASE}/api/collections/cvdiag_events/records`);
    expect([401, 403]).toContain(list.status);
  });

  it("writer key can CREATE a cvdiag_events row", async () => {
    const tok = await keyToken(WRITER_EMAIL, WRITER_PASS);
    const res = await createRow(tok, sampleEvent());
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBeTruthy();
  });

  it("writer key CANNOT DELETE a cvdiag_events row", async () => {
    // Seed a row with the writer key, then attempt to delete it with the
    // same key — must be denied. FIX C: assert the CREATE returned a real id
    // FIRST (else the DELETE hits /records/undefined → a 404 false-green that
    // "proves" a deny over a row that never existed), and confirm the row
    // still exists AFTER the denied DELETE so the deny is real, not vacuous.
    const writerTok = await keyToken(WRITER_EMAIL, WRITER_PASS);
    const id = await createRowOrThrow(writerTok, sampleEvent());
    const del = await fetch(
      `${BASE}/api/collections/cvdiag_events/records/${id}`,
      { method: "DELETE", headers: { authorization: writerTok } },
    );
    // PB returns 404 (not 403) when deleteRule denies access to an existing
    // row — it hides existence rather than leaking it. The status alone is
    // therefore ambiguous (a never-created row would ALSO 404), which is
    // exactly the false-green FIX C closes: the createRowOrThrow above proved
    // the row exists, and the admin readback below proves the denied DELETE
    // did NOT remove it — so this is a REAL deny over a REAL row.
    expect([401, 403, 404]).toContain(del.status);
    expect(await readRowAsAdmin(id)).not.toBeNull();
  });

  it("writer key CANNOT UPDATE a cvdiag_events row", async () => {
    // FIX C: assert the CREATE returned a real id before the deny, and confirm
    // the row was NOT mutated after the denied UPDATE (the proof would be
    // hollow if a silent CREATE failure routed the PATCH to /records/undefined).
    const writerTok = await keyToken(WRITER_EMAIL, WRITER_PASS);
    const id = await createRowOrThrow(writerTok, sampleEvent());
    const upd = await fetch(
      `${BASE}/api/collections/cvdiag_events/records/${id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: writerTok,
        },
        body: JSON.stringify({ schema_version: 2 }),
      },
    );
    expect([401, 403]).toContain(upd.status);
    // The row must exist AND be unmutated (schema_version still 1).
    const after = await readRowAsAdmin(id);
    expect(after).not.toBeNull();
    expect(after?.schema_version).toBe(1);
  });

  it("purge key can DELETE a cvdiag_events row", async () => {
    const writerTok = await keyToken(WRITER_EMAIL, WRITER_PASS);
    const created = await createRow(writerTok, sampleEvent());
    const { id } = (await created.json()) as { id: string };
    const purgeTok = await keyToken(PURGE_EMAIL, PURGE_PASS);
    const del = await fetch(
      `${BASE}/api/collections/cvdiag_events/records/${id}`,
      { method: "DELETE", headers: { authorization: purgeTok } },
    );
    expect(del.status).toBe(204);
  });

  it("migration key CANNOT UPDATE via the API (updateRule=null → history immutable)", async () => {
    // updateRule is null on cvdiag_events, so NO API key — not even the
    // migration key — can PATCH a row. PB rules are record-level (no
    // field-level restriction), so a who-only "migration can update" rule
    // would let the migration key rewrite ANY field, not just
    // schema_version. The real schema_version backfill runs admin-side
    // inside the migration JS (Dao/save), which bypasses collection rules,
    // so forbidding API UPDATEs costs nothing and preserves immutability.
    // FIX C: assert the prerequisite CREATE returned a real id BEFORE the deny
    // — otherwise the PATCH hits /records/undefined → 404 → false-green.
    const writerTok = await keyToken(WRITER_EMAIL, WRITER_PASS);
    const id = await createRowOrThrow(writerTok, sampleEvent());
    const migTok = await keyToken(MIGRATION_EMAIL, MIGRATION_PASS);
    const upd = await fetch(
      `${BASE}/api/collections/cvdiag_events/records/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: migTok },
        body: JSON.stringify({ schema_version: 2 }),
      },
    );
    expect([401, 403]).toContain(upd.status);
    // Confirm the row still EXISTS and was NOT mutated (read back as admin).
    const after = await readRowAsAdmin(id);
    expect(after).not.toBeNull();
    expect(after?.schema_version).toBe(1);
  });

  it("pre-existing diag_events collection keeps its public listRule (unchanged)", async () => {
    const tok = await adminToken();
    const r = await fetch(`${BASE}/api/collections/diag_events`, {
      headers: { authorization: tok },
    });
    expect(r.ok).toBe(true);
    const body = (await r.json()) as { listRule: string | null };
    // diag_events is anonymously readable: listRule === "" (public read).
    expect(body.listRule).toBe("");
  });

  it("CvdiagPbWriter writes events + raw-byte samples + accounting events best-effort", async () => {
    // Exercise the writer against the writer-key REST surface via a PbClient
    // pointed at the writer auth record (NOT the superuser, so the CREATE-only
    // ACL is the real surface under test).
    const writerClient = createPbClient({
      url: BASE,
      // Dummy creds so ensureAuth() fires; writerKeyFetch() intercepts the
      // superuser auth call and substitutes the writer-key auth-collection
      // login, so writes go through the CREATE-only rule (not a superuser
      // bypass).
      email: WRITER_EMAIL,
      password: WRITER_PASS,
      logger,
      fetchImpl: writerKeyFetch(),
    });
    const writer = new CvdiagPbWriter({ pb: writerClient, logger });
    await expect(writer.assertCollectionExists()).resolves.toBe(true);
    await writer.writeEvent(sampleEvent());
    await writer.writeRawByteSample({
      test_id: "0190a0c0-0000-7000-8000-000000000001",
      slug: "langgraph-python",
      ts: "2026-06-18T00:00:00.000Z",
      pipeline_applied: ["decode", "scrub"],
      head_bytes: "abc",
      tail_bytes: "xyz",
      elided_count: 0,
      metadata_dropped: false,
    });
    await writer.writeCollisionDetected({
      test_id: "0190a0c0-0000-7000-8000-000000000001",
      layer: "probe",
      boundary: "probe.start",
      mono_ns: 1,
    });
    // Verify the event landed by counting rows as admin.
    const tok = await adminToken();
    const list = await fetch(
      `${BASE}/api/collections/cvdiag_events/records?filter=${encodeURIComponent(
        'test_id="0190a0c0-0000-7000-8000-000000000001"',
      )}`,
      { headers: { authorization: tok } },
    );
    const body = (await list.json()) as { totalItems: number };
    expect(body.totalItems).toBeGreaterThanOrEqual(1);
  });

  it("assertCollectionExists() is TRUE against the real (migrated) collection via the writer key", async () => {
    // The writer key is CREATE-only (list/view rules null), so the probing
    // list is REJECTED (403) — but that rejection proves the collection
    // exists + the key authenticated. assertCollectionExists must read that
    // as true, not false.
    const writerClient = createPbClient({
      url: BASE,
      email: WRITER_EMAIL,
      password: WRITER_PASS,
      logger,
      fetchImpl: writerKeyFetch(),
    });
    const writer = new CvdiagPbWriter({ pb: writerClient, logger });
    await expect(writer.assertCollectionExists()).resolves.toBe(true);
  });

  it("raw-byte sample joins back to cvdiag_events on a SHARED test_id (FIX 4 correlation)", async () => {
    // Documents the cvdiag_raw_byte_samples ↔ cvdiag_events join: a raw-byte
    // sample written with the SAME test_id as the events resolves the pair.
    // (The d4 driver fix guarantees both sides carry the one minted UUIDv7;
    // here we prove the join mechanic on live PB.)
    const writerClient = createPbClient({
      url: BASE,
      email: WRITER_EMAIL,
      password: WRITER_PASS,
      logger,
      fetchImpl: writerKeyFetch(),
    });
    const writer = new CvdiagPbWriter({ pb: writerClient, logger });
    const sharedTestId = "0190a0c0-0000-7000-8000-0000000000d4";
    await writer.writeEvent(
      sampleEvent({ test_id: sharedTestId, trace_id: sharedTestId }),
    );
    await writer.writeRawByteSample({
      test_id: sharedTestId,
      slug: "langgraph-python",
      ts: "2026-06-18T00:00:00.000Z",
      pipeline_applied: ["decode", "scrub"],
      head_bytes: "abc",
      tail_bytes: "xyz",
      elided_count: 0,
      metadata_dropped: false,
    });
    const tok = await adminToken();
    const filter = encodeURIComponent(`test_id="${sharedTestId}"`);
    const events = (await (
      await fetch(
        `${BASE}/api/collections/cvdiag_events/records?filter=${filter}`,
        { headers: { authorization: tok } },
      )
    ).json()) as { totalItems: number };
    const samples = (await (
      await fetch(
        `${BASE}/api/collections/cvdiag_raw_byte_samples/records?filter=${filter}`,
        { headers: { authorization: tok } },
      )
    ).json()) as { totalItems: number };
    // BOTH sides have a row for the shared test_id → the join returns the pair.
    expect(events.totalItems).toBeGreaterThanOrEqual(1);
    expect(samples.totalItems).toBeGreaterThanOrEqual(1);
  });

  it("writeCollisionDetected persists the collision's REAL layer (e.g. probe), not the backend default", async () => {
    // Regression for the omitted 5th `layer` arg: every collision row used
    // to record layer="backend", mis-bucketing probe/aimock collisions.
    const writerClient = createPbClient({
      url: BASE,
      email: WRITER_EMAIL,
      password: WRITER_PASS,
      logger,
      fetchImpl: writerKeyFetch(),
    });
    const writer = new CvdiagPbWriter({ pb: writerClient, logger });
    const collisionTestId = "0190a0c0-0000-7000-8000-0000000000c1";
    await writer.writeCollisionDetected({
      test_id: collisionTestId,
      layer: "probe",
      boundary: "probe.start",
      mono_ns: 7,
    });
    // Read the persisted accounting row back as admin and assert its layer.
    const tok = await adminToken();
    const list = await fetch(
      `${BASE}/api/collections/cvdiag_events/records?filter=${encodeURIComponent(
        `boundary="cvdiag.collision_detected" && test_id="${collisionTestId}"`,
      )}`,
      { headers: { authorization: tok } },
    );
    const body = (await list.json()) as {
      totalItems: number;
      items: { layer: string }[];
    };
    expect(body.totalItems).toBeGreaterThanOrEqual(1);
    expect(body.items[0].layer).toBe("probe");
  });
});

// A second, MIGRATION-LESS PocketBase used solely to prove
// assertCollectionExists() returns FALSE when the cvdiag_events collection is
// absent (the FIX A behavioral guarantee: a missing migration must degrade,
// not silently drop 100% of events). Boots a bare PB with NO migrationsDir,
// so cvdiag_events never exists; a list against it returns 404.
const PORT_BARE = 8097;
const BASE_BARE = `http://127.0.0.1:${PORT_BARE}`;
const BARE_ADMIN_EMAIL = "cvdiag-bare@test.local";
const BARE_ADMIN_PASS = "cvdiagbarepass123";

async function waitForHealthAt(
  base: string,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("bare PocketBase did not become healthy in time");
}

describeMaybe(
  "cvdiag pb-writer — assertCollectionExists degrades on a MISSING collection",
  () => {
    let barePb: ChildProcess | undefined;
    let bareDataDir: string | undefined;

    beforeAll(async () => {
      bareDataDir = mkdtempSync(join(tmpdir(), "pb-cvdiag-bare-"));
      // Apply ONLY PocketBase's bundled system migrations (no
      // --migrationsDir), which initializes the `_admins` table so
      // `admin create` works — but DELIBERATELY skips the cvdiag migrations,
      // so `cvdiag_events` never exists and a list against it returns 404.
      const mig = spawnSync(
        PB_BIN as string,
        ["migrate", "up", `--dir=${bareDataDir}`],
        { encoding: "utf8" },
      );
      if (mig.status !== 0) {
        throw new Error(
          `bare pb migrate up failed: ${mig.stderr || mig.stdout}`,
        );
      }
      const admin = spawnSync(
        PB_BIN as string,
        [
          "admin",
          "create",
          BARE_ADMIN_EMAIL,
          BARE_ADMIN_PASS,
          `--dir=${bareDataDir}`,
        ],
        { encoding: "utf8" },
      );
      if (admin.status !== 0) {
        throw new Error(
          `bare pb admin create failed: ${admin.stderr || admin.stdout}`,
        );
      }
      barePb = spawn(
        PB_BIN as string,
        ["serve", `--http=127.0.0.1:${PORT_BARE}`, `--dir=${bareDataDir}`],
        { stdio: "ignore" },
      );
      await waitForHealthAt(BASE_BARE);
    }, 30_000);

    afterAll(() => {
      if (barePb) barePb.kill("SIGKILL");
      if (bareDataDir) rmSync(bareDataDir, { recursive: true, force: true });
    });

    it("returns FALSE when cvdiag_events does not exist (missing migration)", async () => {
      // A superuser-backed client: it CAN reach PB (health ok) and CAN list,
      // so the only reason the probe fails is the collection's absence (404).
      // The old health()-only implementation returned true here and silently
      // dropped every event; the fix must return false so the writer degrades.
      const client = createPbClient({
        url: BASE_BARE,
        email: BARE_ADMIN_EMAIL,
        password: BARE_ADMIN_PASS,
        logger,
      });
      const writer = new CvdiagPbWriter({ pb: client, logger });
      await expect(writer.assertCollectionExists()).resolves.toBe(false);
    });
  },
);

/**
 * A fetch wrapper that authenticates against the cvdiag_api_keys WRITER
 * record instead of a superuser. The PbClient is built for superuser
 * email/password auth; here we intercept its auth call and substitute the
 * writer-key auth-with-password endpoint so CREATE goes through the
 * CREATE-only rule rather than a rule-bypassing superuser.
 *
 * CRITICAL (PB ≤0.22 fallback): pb-client tries
 * `/api/collections/_superusers/auth-with-password` FIRST and, on a 404,
 * FALLS BACK to `/api/admins/auth-with-password` (the PB 0.22 admin endpoint).
 * On the pinned PB 0.22.21 binary the `/_superusers` collection does not
 * exist, so the client ALWAYS takes the `/api/admins` fallback. If only
 * `/_superusers` were intercepted here, that intercept would 404 just like the
 * real server, the client would fall through to `/api/admins` UN-intercepted,
 * and — were the supplied creds an admin — it would authenticate as a
 * rule-bypassing superuser, making the CREATE-only ACL + immutability proofs
 * HOLLOW. We therefore intercept BOTH auth endpoints and redirect each to the
 * writer-key auth collection, so the client genuinely authenticates with the
 * CREATE-only writer key and the ACL is the real surface under test.
 */
function writerKeyFetch(): typeof fetch {
  const isAuthUrl = (url: string): boolean =>
    url.includes("/api/collections/_superusers/auth-with-password") ||
    url.includes("/api/admins/auth-with-password");
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (isAuthUrl(url)) {
      // Redirect BOTH the v0.23 `/_superusers` attempt AND the v0.22
      // `/api/admins` fallback to the writer-key auth collection.
      return fetch(
        `${BASE}/api/collections/cvdiag_api_keys/auth-with-password`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            identity: WRITER_EMAIL,
            password: WRITER_PASS,
          }),
        },
      );
    }
    return fetch(input, init);
  }) as unknown as typeof fetch;
}

/**
 * FIX 3 (typed status, not regex): `assertCollectionExists` must classify the
 * collection-probe rejection by the TYPED HTTP status carried on
 * `PbHttpError.statusCode`, NOT by substring-matching the rendered message.
 * These are pure-unit tests (a tiny fake `CvdiagWriterClient`), so they run
 * with no PocketBase binary.
 */
function fakeClient(listImpl: () => Promise<never>): CvdiagWriterClient {
  return {
    create: async <T>() => ({}) as T,
    list: <T>(_c: string, _o?: ListOpts) =>
      listImpl() as unknown as Promise<ListResult<T>>,
    health: async () => true,
  };
}

/**
 * A fake whose `list` outcome depends on the collection name, so a PARTIAL
 * migration (one collection present, the other absent) can be modeled. Each
 * entry is the per-collection list behavior; a successful list resolves to an
 * empty page, a failure rejects with the supplied error.
 */
function perCollectionClient(
  byCollection: Record<string, "ok" | PbHttpError>,
): CvdiagWriterClient {
  return {
    create: async <T>() => ({}) as T,
    list: <T>(collection: string, _o?: ListOpts) => {
      const outcome = byCollection[collection];
      if (outcome === "ok") {
        return Promise.resolve({
          page: 1,
          perPage: 1,
          totalItems: 0,
          totalPages: 0,
          items: [],
        } as unknown as ListResult<T>);
      }
      return Promise.reject(outcome) as unknown as Promise<ListResult<T>>;
    },
    health: async () => true,
  };
}

describe("cvdiag pb-writer — assertCollectionExists uses typed status (FIX 3)", () => {
  it("RED-PROOF: a 404 whose BODY contains '401' must read FALSE (regex would misread it as exists)", async () => {
    // The pre-fix `/\b(401|403)\b/.test(String(err))` matched the substring
    // "401" anywhere in the rendered error — including in a 404 response body
    // — and wrongly returned true (collection "exists"). The typed check keys
    // on statusCode === 404 → false.
    const err = new PbHttpError({
      statusCode: 404,
      bodyText:
        '{"code":404,"message":"missing","data":{"hint":"was 401 earlier"}}',
      path: "/api/collections/cvdiag_events/records?perPage=1",
    });
    // Sanity: the old regex WOULD have matched this body → the bug it guards.
    expect(/\b(401|403)\b/.test(String(err))).toBe(true);
    const writer = new CvdiagPbWriter({
      pb: fakeClient(() => Promise.reject(err)),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(false);
  });

  it("GREEN: a typed 403 reads TRUE (CREATE-only ACL forbids read, but collection exists)", async () => {
    const err = new PbHttpError({
      statusCode: 403,
      bodyText: '{"code":403,"message":"forbidden"}',
      path: "/api/collections/cvdiag_events/records?perPage=1",
    });
    const writer = new CvdiagPbWriter({
      pb: fakeClient(() => Promise.reject(err)),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(true);
  });

  it("GREEN: a typed 401 reads FALSE (auth FAILED — NOT proof the collection exists → degrade)", async () => {
    // FIX A: 401 means authentication failed (bad/missing writer key; the
    // SDK's ensureAuth warns-and-returns without a token), NOT that the
    // collection is present. The pre-fix code lumped 401 in with 403 and
    // returned true, so a misconfigured key was misread as "healthy", the
    // writer was injected, and every subsequent write silently 401-dropped —
    // the exact 100%-silent-drop failure this gate exists to prevent. The fix
    // degrades on 401.
    const err = new PbHttpError({
      statusCode: 401,
      bodyText: '{"code":401,"message":"unauthorized"}',
      path: "/api/collections/cvdiag_events/records?perPage=1",
    });
    const writer = new CvdiagPbWriter({
      pb: fakeClient(() => Promise.reject(err)),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(false);
  });

  it("GREEN: a 5xx degrades to FALSE (cannot confirm → no-op rather than drop)", async () => {
    const err = new PbHttpError({
      statusCode: 503,
      bodyText: "service unavailable",
      path: "/api/collections/cvdiag_events/records?perPage=1",
    });
    const writer = new CvdiagPbWriter({
      pb: fakeClient(() => Promise.reject(err)),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(false);
  });

  it("GREEN: a non-HTTP transport error degrades to FALSE", async () => {
    const writer = new CvdiagPbWriter({
      pb: fakeClient(() => Promise.reject(new Error("ECONNREFUSED"))),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(false);
  });
});

describe("cvdiag pb-writer — assertCollectionExists gates BOTH collections (FIX B)", () => {
  const missing = (collection: string) =>
    new PbHttpError({
      statusCode: 404,
      bodyText: '{"code":404,"message":"missing collection"}',
      path: `/api/collections/${collection}/records?perPage=1`,
    });

  it("RED-PROOF: a PARTIAL migration (events present, raw_byte_samples ABSENT) degrades to FALSE", async () => {
    // Pre-fix, assertCollectionExists probed ONLY cvdiag_events, so a partial
    // migration where cvdiag_raw_byte_samples is missing passed the gate — the
    // writer was injected and then writeRawByteSample 404-spammed on every
    // DEBUG-tier sample. The fix probes BOTH collections.
    const writer = new CvdiagPbWriter({
      pb: perCollectionClient({
        [CVDIAG_EVENTS_COLLECTION]: "ok",
        [CVDIAG_RAW_BYTE_SAMPLES_COLLECTION]: missing(
          CVDIAG_RAW_BYTE_SAMPLES_COLLECTION,
        ),
      }),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(false);
  });

  it("the inverse partial (events absent, raw_byte_samples present) also degrades to FALSE", async () => {
    const writer = new CvdiagPbWriter({
      pb: perCollectionClient({
        [CVDIAG_EVENTS_COLLECTION]: missing(CVDIAG_EVENTS_COLLECTION),
        [CVDIAG_RAW_BYTE_SAMPLES_COLLECTION]: "ok",
      }),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(false);
  });

  it("GREEN: BOTH collections present (or 403 = present) → TRUE", async () => {
    const writer = new CvdiagPbWriter({
      pb: perCollectionClient({
        [CVDIAG_EVENTS_COLLECTION]: "ok",
        [CVDIAG_RAW_BYTE_SAMPLES_COLLECTION]: "ok",
      }),
      logger,
    });
    await expect(writer.assertCollectionExists()).resolves.toBe(true);
  });
});
