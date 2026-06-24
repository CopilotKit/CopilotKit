/**
 * pb-writer-fetch.test.ts — RED→GREEN for the CONCRETE, plain-`fetch`,
 * WRITER-ROLE PB writer that the TS integration backends inject (the fix for
 * the type-only-seam defect where backend telemetry never persisted).
 *
 * Drives `CvdiagFetchPbWriter` against a LIVE PocketBase, authenticating as the
 * `cvdiag_api_keys` record with role `writer` (NOT superuser) — exactly the §4
 * three-key-ACL contract a deployed integration must honor. The superuser token
 * is used ONLY for the read-back assertion (cvdiag_events list/view is
 * superuser-only by design).
 *
 * Coverage:
 *   - GREEN: a batch persists to cvdiag_events via writer-role auth.
 *   - A WRONG writer key degrades to a no-op (zero rows) and NEVER throws
 *     (best-effort, pure-instrumentation contract).
 *   - A pre-cached but EXPIRED/invalid token triggers a re-auth on 401 and the
 *     row still lands.
 *
 * Requires a `pocketbase` binary (POCKETBASE_BIN, on PATH, or
 * /tmp/pb022/pocketbase). SKIPS when absent so CI without the binary stays
 * green.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CvdiagFetchPbWriter } from "./pb-writer-fetch.js";
import type { CvdiagEnvelope } from "./schema.js";

const PB_BIN = resolvePbBinary();
const PORT = 8095;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "cvdiag-fetch-e2e@test.local";
const ADMIN_PASS = "cvdiagfetche2epass123";

// Seeded by migration 1779990200 (role `writer`). NON-SECRET bootstrap
// defaults — what a deployed integration authenticates as (NOT a superuser).
const WRITER_IDENTITY = "cvdiag-writer@keys.local";
const WRITER_PASSWORD = "cvdiagwriterpass123";

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

async function countRows(testId: string): Promise<number> {
  const tok = await adminToken();
  const list = await fetch(
    `${BASE}/api/collections/cvdiag_events/records?filter=${encodeURIComponent(
      `test_id="${testId}"`,
    )}`,
    { headers: { authorization: tok } },
  );
  const body = (await list.json()) as { totalItems: number };
  return body.totalItems;
}

let counter = 0;
function makeEnvelope(slug: string): CvdiagEnvelope {
  // A fresh UUIDv7-shaped id per call so cases don't collide.
  const n = (++counter).toString(16).padStart(12, "0");
  const id = `01900000-0000-7000-8000-${n}`;
  return {
    schema_version: 1,
    test_id: id,
    trace_id: id,
    span_id: "0123456789abcdef",
    parent_span_id: null,
    layer: "backend",
    boundary: "backend.agent.enter",
    slug,
    demo: slug,
    ts: new Date().toISOString(),
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
    metadata: { agent_name: "default", model_id: "gpt-4" },
  };
}

let pb: ChildProcess | undefined;
let dataDir: string | undefined;

const describeMaybe = PB_BIN ? describe : describe.skip;

describeMaybe("CvdiagFetchPbWriter — live PocketBase, WRITER-role auth", () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "pb-cvdiag-fetch-"));
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

  it("persists a batch to cvdiag_events authenticating as the writer role", async () => {
    const writer = new CvdiagFetchPbWriter({
      baseUrl: BASE,
      writerKey: WRITER_PASSWORD,
      writerIdentity: WRITER_IDENTITY,
    });
    const env = makeEnvelope("fetch-writer-green");
    await writer.writeBatch([env]);
    expect(await countRows(env.test_id)).toBe(1);
  }, 30_000);

  it("degrades to a no-op (never throws) on a WRONG writer key", async () => {
    const writer = new CvdiagFetchPbWriter({
      baseUrl: BASE,
      writerKey: "wrong-password-xxxxxxxx",
      writerIdentity: WRITER_IDENTITY,
    });
    const env = makeEnvelope("fetch-writer-badkey");
    // Must resolve (never reject) — best-effort pure instrumentation.
    await expect(writer.writeBatch([env])).resolves.toBeUndefined();
    // And nothing persisted (auth failed → no Bearer token → bailed).
    expect(await countRows(env.test_id)).toBe(0);
  }, 30_000);

  it("re-auths on a stale cached token and the row still lands", async () => {
    const writer = new CvdiagFetchPbWriter({
      baseUrl: BASE,
      writerKey: WRITER_PASSWORD,
      writerIdentity: WRITER_IDENTITY,
    });
    // Poison the cached token so the first CREATE is rejected (PB treats an
    // unverifiable token as anonymous → createRule denies → 400, NOT 401), and
    // the writer must re-auth + retry to recover.
    (writer as unknown as { token: string | null }).token =
      "stale.invalid.token";
    const env = makeEnvelope("fetch-writer-reauth");
    await writer.writeBatch([env]);
    expect(await countRows(env.test_id)).toBe(1);
  }, 30_000);

  it("empty batch is a no-op (no auth attempt)", async () => {
    const writer = new CvdiagFetchPbWriter({
      baseUrl: BASE,
      writerKey: WRITER_PASSWORD,
      writerIdentity: WRITER_IDENTITY,
    });
    await expect(writer.writeBatch([])).resolves.toBeUndefined();
  }, 30_000);
});
