import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPbClient } from "../storage/pb-client.js";
import { logger } from "../logger.js";
import { CvdiagPbWriter } from "./pb-writer.js";
import { CvdiagEmitter } from "./emit.js";

// End-to-end proof of the CVDIAG emit→persist SEAM against a LIVE PocketBase.
//
// This is the feature-level red-green for the wiring fix: it constructs a real
// `CvdiagEmitter` WITH a real `CvdiagPbWriter` injected (the production shape),
// emits a real probe-layer boundary event, flushes the emitter's background
// queue, and reads the row BACK out of the `cvdiag_events` collection — proving
// the whole seam (emit → queue → flush → writeBatch → PB CREATE) actually
// persists.
//
// RED (pre-fix): the `CvdiagPbWriter` class had NO `writeBatch` method, so the
// class did not satisfy the emitter's `pbWriter` interface — passing it to
// `new CvdiagEmitter({ pbWriter })` was a COMPILE error (TS2741), and even if
// forced past TS the flush would `this.pbWriter.writeBatch(...)` on undefined.
// No row ever landed in cvdiag_events from an emitter. GREEN (post-fix): the
// class implements `writeBatch`, the injection type-checks, and the emitted
// event is read back below.
//
// Requires a `pocketbase` binary. Set POCKETBASE_BIN to its path (the cvdiag
// suites resolve POCKETBASE_BIN, NOT PB_BIN), or put it on PATH, or drop it at
// /tmp/pb022/pocketbase. The suite SKIPS (not fails) when no binary is
// available so CI without the binary stays green.

const PB_BIN = resolvePbBinary();
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "cvdiag-e2e@test.local";
const ADMIN_PASS = "cvdiage2epass123";

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

let pb: ChildProcess | undefined;
let dataDir: string | undefined;

const describeMaybe = PB_BIN ? describe : describe.skip;

describeMaybe("cvdiag emit→persist seam — live PocketBase", () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "pb-cvdiag-e2e-"));
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

  it("emitter WITH an injected CvdiagPbWriter persists an emitted event to cvdiag_events on flush", async () => {
    // Superuser-backed client — bypasses the CREATE-only ACL for both the
    // write and the read-back (the production fleet worker injects its own
    // superuser PbClient the same way; the cvdiag CLI does too — see cli-pb.ts).
    const pbClient = createPbClient({
      url: BASE,
      email: ADMIN_EMAIL,
      password: ADMIN_PASS,
      logger,
    });
    const writer = new CvdiagPbWriter({ pb: pbClient, logger });

    // The production injection shape: a real emitter with a real writer seam.
    const emitter = new CvdiagEmitter({
      env: { NODE_ENV: "test" },
      layer: "probe",
      pbWriter: writer,
    });

    // A boundary that is emitted at the DEFAULT tier (probe.message.send is
    // default:true in the tier matrix), so it lands in the queue without
    // needing verbose/debug.
    const envelope = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "langgraph-python",
      demo: "agentic-chat",
      outcome: "ok",
      // `char_count` is in the closed-world metadata allow-list for
      // probe.message.send (schema.ts BOUNDARY_METADATA_KEYS), so it survives
      // validation and proves the metadata bag persists end-to-end.
      metadata: { char_count: 42 },
    });
    expect(envelope).not.toBeNull();
    const testId = envelope!.test_id;
    expect(emitter.queueDepth()).toBe(1);

    // Drain the queue to PB through the wired writer.
    await emitter.flush();
    expect(emitter.queueDepth()).toBe(0);

    // Read the row BACK out of cvdiag_events (as admin) and assert the seam
    // persisted it with the right fields.
    const tok = await adminToken();
    const list = await fetch(
      `${BASE}/api/collections/cvdiag_events/records?filter=${encodeURIComponent(
        `test_id="${testId}"`,
      )}`,
      { headers: { authorization: tok } },
    );
    const body = (await list.json()) as {
      totalItems: number;
      items: Array<{
        test_id: string;
        layer: string;
        boundary: string;
        slug: string;
        demo: string;
        outcome: string;
        metadata: Record<string, unknown>;
      }>;
    };
    expect(body.totalItems).toBe(1);
    const row = body.items[0];
    expect(row.test_id).toBe(testId);
    expect(row.layer).toBe("probe");
    expect(row.boundary).toBe("probe.message.send");
    expect(row.slug).toBe("langgraph-python");
    expect(row.demo).toBe("agentic-chat");
    expect(row.outcome).toBe("ok");
    expect(row.metadata.char_count).toBe(42);
  }, 30_000);

  it("emitter with NO writer is a flush no-op (pre-wiring behavior preserved)", async () => {
    // No pbWriter injected → the queue is retained and NOTHING is written.
    const emitter = new CvdiagEmitter({
      env: { NODE_ENV: "test" },
      layer: "probe",
    });
    const envelope = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "mastra",
      demo: "agentic-chat",
      outcome: "ok",
      metadata: {},
    });
    expect(envelope).not.toBeNull();
    const testId = envelope!.test_id;

    await emitter.flush();
    // Queue is INTACT (no writer → flush leaves it, per the pbWriter contract).
    expect(emitter.queueDepth()).toBe(1);

    // And nothing landed in PB for that test_id.
    const tok = await adminToken();
    const list = await fetch(
      `${BASE}/api/collections/cvdiag_events/records?filter=${encodeURIComponent(
        `test_id="${testId}"`,
      )}`,
      { headers: { authorization: tok } },
    );
    const body = (await list.json()) as { totalItems: number };
    expect(body.totalItems).toBe(0);
  }, 30_000);
});
