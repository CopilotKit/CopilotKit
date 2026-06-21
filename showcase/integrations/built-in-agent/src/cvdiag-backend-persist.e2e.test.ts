/**
 * cvdiag-backend-persist.e2e.test.ts — feature-level RED→GREEN for the
 * production defect: the TS integration backends never persist telemetry
 * because `withCvdiagBackend` constructs a `CvdiagEmitter` with NO concrete
 * `pbWriter`, so flush is a no-op and zero rows ever land in `cvdiag_events`.
 *
 * This drives the REAL public `withCvdiagBackend` wrapper against a LIVE
 * PocketBase, authenticating as the WRITER ROLE (`cvdiag_api_keys`, role
 * `writer`) — NOT a superuser — exactly as a deployed integration would. The
 * superuser token is used ONLY for the read-back assertion (the collection's
 * list/view rules are superuser-only by design).
 *
 * RED (pre-fix): with `CVDIAG_PB_URL` set but no concrete writer wired into
 * `withCvdiagBackend`, the emitter's `pbWriter` is undefined → flush no-ops →
 * cvdiag_events has ZERO rows for the request's test_id.
 *
 * GREEN (post-fix): `withCvdiagBackend` constructs the concrete writer-role PB
 * writer when `CVDIAG_PB_URL` is set, auth-with-passwords as `writer`, and the
 * backend boundaries persist. A WRONG `CVDIAG_WRITER_KEY` degrades to a no-op
 * (best-effort, never-throw) — the request still succeeds, zero rows land.
 *
 * Requires a `pocketbase` binary (POCKETBASE_BIN, or on PATH, or
 * /tmp/pb022/pocketbase). SKIPS when absent so CI without the binary stays
 * green.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { withCvdiagBackend } from "@/cvdiag-backend";

const PB_BIN = resolvePbBinary();
const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "cvdiag-bia-e2e@test.local";
const ADMIN_PASS = "cvdiagbiae2epass123";

// Seeded by migration 1779990200: a `cvdiag_api_keys` record with role
// `writer`. These NON-SECRET bootstrap defaults are what a deployed
// integration authenticates as (NOT a superuser).
const WRITER_IDENTITY = "cvdiag-writer@keys.local";
const WRITER_PASSWORD = "cvdiagwriterpass123";

// harness/pocketbase holds the canonical migrations (the integration build
// context has none of its own); resolve them off the monorepo root.
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

/** A streaming handler that stamps a known test_id into a response header so
 * the test can correlate the persisted rows. The backend wrapper mints its
 * OWN test_id per request, so instead we read it back from the first persisted
 * row by slug — but to keep the assertion deterministic we count rows by the
 * UNIQUE slug used per case. */
function streamingHandler(): (req: Request) => Promise<Response> {
  return async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: hi\n\n"));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
}

async function countRowsBySlug(slug: string): Promise<number> {
  const tok = await adminToken();
  const list = await fetch(
    `${BASE}/api/collections/cvdiag_events/records?perPage=200&filter=${encodeURIComponent(
      `slug="${slug}"`,
    )}`,
    { headers: { authorization: tok } },
  );
  const body = (await list.json()) as { totalItems: number };
  return body.totalItems;
}

/** Drive one wrapped request to completion, fully draining the body so the
 * stream-close terminals + background flush fire. */
async function driveRequest(
  slug: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const wrapped = withCvdiagBackend(streamingHandler(), {
      slug,
      agentName: "default",
      provider: "openai",
    });
    const req = new Request("https://example.test/api/copilotkit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const res = await wrapped(req);
    // Fully drain the body so the monitored stream closes → terminals emit.
    await res.text();
  } finally {
    // Restore env so cases don't leak into each other.
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  // Allow the background flush window (FLUSH_WINDOW_MS=1000) to drain.
  await new Promise((r) => setTimeout(r, 1500));
}

let pb: ChildProcess | undefined;
let dataDir: string | undefined;

const describeMaybe = PB_BIN ? describe : describe.skip;

describeMaybe(
  "cvdiag backend emit→persist seam — live PocketBase, WRITER-role auth",
  () => {
    beforeAll(async () => {
      dataDir = mkdtempSync(join(tmpdir(), "pb-cvdiag-bia-e2e-"));
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

    it("persists backend boundaries to cvdiag_events when CVDIAG_PB_URL is set (writer-role auth)", async () => {
      const slug = "bia-persist-green";
      await driveRequest(slug, {
        CVDIAG_BACKEND_EMITTER: "1",
        CVDIAG_PB_URL: BASE,
        CVDIAG_WRITER_KEY: WRITER_PASSWORD,
        SHOWCASE_ENV: "test",
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv);

      // GREEN: rows persisted via writer-role auth-with-password.
      const rows = await countRowsBySlug(slug);
      expect(rows).toBeGreaterThan(0);
    }, 30_000);

    it("is a no-op when CVDIAG_PB_URL is unset (stdout-only, current behavior)", async () => {
      const slug = "bia-persist-nourl";
      await driveRequest(slug, {
        CVDIAG_BACKEND_EMITTER: "1",
        SHOWCASE_ENV: "test",
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv);

      // No CVDIAG_PB_URL → no writer injected → zero rows (pre-fix behavior
      // preserved for the no-PB deployment).
      const rows = await countRowsBySlug(slug);
      expect(rows).toBe(0);
    }, 30_000);

    it("degrades to a no-op (never throws) on a WRONG writer key", async () => {
      const slug = "bia-persist-badkey";
      // A wrong password must NOT throw into the wrapped handler; the request
      // succeeds and zero rows persist (best-effort, never-throw contract).
      await expect(
        driveRequest(slug, {
          CVDIAG_BACKEND_EMITTER: "1",
          CVDIAG_PB_URL: BASE,
          CVDIAG_WRITER_KEY: "wrong-password-xxxxxxxx",
          SHOWCASE_ENV: "test",
          NODE_ENV: "test",
        } as NodeJS.ProcessEnv),
      ).resolves.toBeUndefined();

      const rows = await countRowsBySlug(slug);
      expect(rows).toBe(0);
    }, 30_000);
  },
);
