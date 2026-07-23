import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJobClaimClient } from "../../../src/fleet/job-claim.js";
import { logger } from "../../../src/logger.js";

// Real-PocketBase concurrency proof for the fleet job-claim primitive.
//
// This is the S1 spike, frozen as a regression test: it stands up an
// actual PocketBase 0.22 server using the EXACT production migrations
// (showcase/pocketbase/pb_migrations) and JSVM hooks
// (showcase/pocketbase/pb_hooks), then races N concurrent claimers for the
// same pending row and asserts EXACTLY ONE wins. This is the empirical
// evidence that the transactional-endpoint mechanism (not a rule-guarded
// PATCH, which the superuser bypasses) yields exactly-one-winner.
//
// Requires a `pocketbase` binary. Set POCKETBASE_BIN to its path, or put it
// on PATH. The suite skips (not fails) when no binary is available so CI
// without the binary stays green; the unit suite (src/fleet/job-claim.test.ts)
// always runs.

const PB_BIN = resolvePbBinary();
const N = 20;
const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "claim-spike@test.local";
const ADMIN_PASS = "claimspikepass123";

const REPO_PB_DIR = resolve(__dirname, "../../../../pocketbase");
const MIGRATIONS_DIR = join(REPO_PB_DIR, "pb_migrations");
const HOOKS_DIR = join(REPO_PB_DIR, "pb_hooks");

function resolvePbBinary(): string | null {
  const explicit = process.env.POCKETBASE_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  const probe = spawnSync("which", ["pocketbase"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
  // Spike-local default used while developing this primitive.
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

async function mintPendingJob(tok: string, key: string): Promise<string> {
  const r = await fetch(`${BASE}/api/collections/probe_jobs/records`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: tok },
    body: JSON.stringify({ probe_key: key, status: "pending", version: 0 }),
  });
  if (!r.ok) throw new Error(`mint job: ${r.status} ${await r.text()}`);
  const body = (await r.json()) as { id: string };
  return body.id;
}

async function readJob(
  tok: string,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/collections/probe_jobs/records/${id}`, {
    headers: { authorization: tok },
  });
  return (await r.json()) as Record<string, unknown>;
}

let pb: ChildProcess | undefined;
let dataDir: string | undefined;

const describeMaybe = PB_BIN ? describe : describe.skip;

describeMaybe("fleet job-claim — real PocketBase concurrency proof", () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "pb-claim-spike-"));
    // Apply the production migrations against the fresh data dir.
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

  function client() {
    return createJobClaimClient({
      url: BASE,
      email: ADMIN_EMAIL,
      password: ADMIN_PASS,
      logger,
    });
  }

  it("exactly one of N concurrent claimers wins", async () => {
    const tok = await adminToken();
    const jobId = await mintPendingJob(tok, "svc:concurrent-claim");
    const c = client();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => c.claimJob(jobId, `worker-${i}`, 30)),
    );
    const winners = results.filter((r) => r.won);
    expect(winners.length).toBe(1);
    // The persisted row reflects exactly the winner.
    const row = await readJob(tok, jobId);
    expect(row.status).toBe("claimed");
    expect(row.claimed_by).toBe(winners[0].job?.claimed_by);
    expect(row.version).toBe(1);
  });

  it("a second claim on an already-claimed (live-lease) row loses", async () => {
    const tok = await adminToken();
    const jobId = await mintPendingJob(tok, "svc:second-claim");
    const c = client();
    const first = await c.claimJob(jobId, "worker-a", 60);
    expect(first.won).toBe(true);
    const second = await c.claimJob(jobId, "worker-b", 60);
    expect(second.won).toBe(false);
  });

  it("renewLease extends the lease for the holder and promotes to running", async () => {
    const tok = await adminToken();
    const jobId = await mintPendingJob(tok, "svc:renew");
    const c = client();
    const claim = await c.claimJob(jobId, "worker-r", 60);
    expect(claim.won).toBe(true);
    const renew = await c.renewLease(jobId, "worker-r", 60);
    expect(renew.renewed).toBe(true);
    expect(renew.job?.status).toBe("running");
    expect(renew.job?.version).toBe(2);
    // A non-holder cannot renew.
    const bad = await c.renewLease(jobId, "worker-other", 60);
    expect(bad.renewed).toBe(false);
  });

  it("an expired lease is reclaimable by a new worker", async () => {
    const tok = await adminToken();
    const jobId = await mintPendingJob(tok, "svc:expiry");
    const c = client();
    // Claim with a lease that has effectively already expired (1s, then
    // wait it out) so the reaper/next-claimer path engages.
    const first = await c.claimJob(jobId, "worker-dead", 1);
    expect(first.won).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    const reclaim = await c.claimJob(jobId, "worker-fresh", 30);
    expect(reclaim.won).toBe(true);
    expect(reclaim.job?.claimed_by).toBe("worker-fresh");
    // The original holder can no longer renew — its lease was stolen.
    const stale = await c.renewLease(jobId, "worker-dead", 30);
    expect(stale.renewed).toBe(false);
  });

  it("releaseJob records a terminal status for the holder", async () => {
    const tok = await adminToken();
    const jobId = await mintPendingJob(tok, "svc:release");
    const c = client();
    await c.claimJob(jobId, "worker-x", 60);
    await c.renewLease(jobId, "worker-x", 60); // → running
    const rel = await c.releaseJob(jobId, "worker-x", "done");
    expect(rel.released).toBe(true);
    expect(rel.job?.status).toBe("done");
    // A non-holder cannot release.
    const jobId2 = await mintPendingJob(tok, "svc:release2");
    await c.claimJob(jobId2, "worker-y", 60);
    await c.renewLease(jobId2, "worker-y", 60);
    const badRel = await c.releaseJob(jobId2, "worker-z", "done");
    expect(badRel.released).toBe(false);
  });
});
