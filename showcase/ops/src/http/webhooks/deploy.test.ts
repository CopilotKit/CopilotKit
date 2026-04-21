import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerDeployWebhook } from "./deploy.js";
import {
  createEventBus,
  type DeployResultEvent,
} from "../../events/event-bus.js";
import { canonicalPayload, computeSignature } from "../hmac.js";
import { createMetricsRegistry, renderPrometheus } from "../metrics.js";
import { logger } from "../../logger.js";

const NOW = 1_700_000_000;
const PATH = "/webhooks/deploy";
const SECRET = "primary";

function signed(
  body: string,
  ts = NOW,
): { headers: Record<string, string>; body: string } {
  const canonical = canonicalPayload("POST", PATH, String(ts), body);
  const sig = computeSignature(SECRET, canonical);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "X-Ops-Timestamp": String(ts),
      "X-Ops-Signature": `sha256=${sig}`,
    },
  };
}

function buildApp(): {
  app: Hono;
  bus: ReturnType<typeof createEventBus>;
  seen: DeployResultEvent[];
} {
  const app = new Hono();
  const bus = createEventBus();
  const seen: DeployResultEvent[] = [];
  bus.on("deploy.result", (e) => {
    seen.push(e);
  });
  registerDeployWebhook(app, {
    bus,
    logger,
    secrets: [SECRET],
    nowSec: () => NOW,
  });
  return { app, bus, seen };
}

describe("POST /webhooks/deploy", () => {
  let app: Hono;
  let seen: DeployResultEvent[];

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
    seen = built.seen;
  });

  it("accepts a valid signed payload and emits deploy.result", async () => {
    const payload = JSON.stringify({
      runId: "42",
      runUrl: "https://github.com/x/y/actions/runs/42",
      services: ["a", "b"],
      failed: [],
      succeeded: ["a", "b"],
      cancelled: false,
    });
    const { headers, body } = signed(payload);
    const res = await app.request(PATH, { method: "POST", headers, body });
    expect(res.status).toBe(202);
    expect(seen).toHaveLength(1);
    expect(seen[0].runId).toBe("42");
    expect(seen[0].services).toEqual(["a", "b"]);
    expect(seen[0].succeeded).toEqual(["a", "b"]);
    expect(seen[0].cancelled).toBe(false);
  });

  it("rejects a stale timestamp with 401", async () => {
    const payload = JSON.stringify({
      runId: "1",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const { headers, body } = signed(payload, NOW - 10_000);
    const res = await app.request(PATH, { method: "POST", headers, body });
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("rejects a wrong signature with 401", async () => {
    const payload = JSON.stringify({
      runId: "1",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": "sha256=deadbeef",
      },
      body: payload,
    });
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("rejects missing signature header with 401", async () => {
    const payload = JSON.stringify({
      runId: "1",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
      },
      body: payload,
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON body with 400", async () => {
    const body = "not-json";
    const canonical = canonicalPayload("POST", PATH, String(NOW), body);
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body,
    });
    expect(res.status).toBe(400);
  });

  it("rejects payload missing required fields with 400 including zod-flatten detail", async () => {
    const body = JSON.stringify({ runId: "1" });
    const canonical = canonicalPayload("POST", PATH, String(NOW), body);
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body,
    });
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as {
      reason: string;
      errors?: { fieldErrors?: Record<string, string[]> };
    };
    expect(parsed.reason).toBe("invalid-payload");
    // Flatten includes field-level issues so a signer can self-diagnose
    // without reading the ops service log.
    expect(parsed.errors).toBeDefined();
    expect(parsed.errors!.fieldErrors).toBeDefined();
  });

  it("rejects a javascript: runUrl scheme with 400", async () => {
    const body = JSON.stringify({
      runId: "1",
      runUrl: "javascript:alert(1)",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const canonical = canonicalPayload("POST", PATH, String(NOW), body);
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body,
    });
    expect(res.status).toBe(400);
  });

  it("accepts an http runUrl scheme", async () => {
    const body = JSON.stringify({
      runId: "2",
      runUrl: "http://example.com/run/2",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const canonical = canonicalPayload("POST", PATH, String(NOW), body);
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body,
    });
    expect(res.status).toBe(202);
  });
});

describe("POST /webhooks/deploy — webhook_rejections metric wiring", () => {
  it("increments webhook_rejections on stale timestamp (and mirrors to hmac_failures)", async () => {
    const app = new Hono();
    const bus = createEventBus();
    const metrics = createMetricsRegistry();
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      metrics,
    });
    const body = JSON.stringify({
      runId: "1",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const { headers } = signed(body, NOW - 10_000);
    const res = await app.request(PATH, { method: "POST", headers, body });
    expect(res.status).toBe(401);
    const text = renderPrometheus(metrics);
    expect(text).toMatch(
      /showcase_ops_webhook_rejections\{reason="stale"\}\s+1/,
    );
    // Deprecated alias still populated for HMAC-category reasons.
    expect(text).toMatch(/showcase_ops_hmac_failures\{reason="stale"\}\s+1/);
  });

  it("increments webhook_rejections on bad signature", async () => {
    const app = new Hono();
    const bus = createEventBus();
    const metrics = createMetricsRegistry();
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      metrics,
    });
    const body = JSON.stringify({
      runId: "1",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": "sha256=deadbeef",
      },
      body,
    });
    expect(res.status).toBe(401);
    const text = renderPrometheus(metrics);
    expect(text).toMatch(
      /showcase_ops_webhook_rejections\{reason="bad-signature"\}\s+1/,
    );
    expect(text).toMatch(
      /showcase_ops_hmac_failures\{reason="bad-signature"\}\s+1/,
    );
  });

  it("increments webhook_rejections on missing signature (split-reason: missing-signature)", async () => {
    const app = new Hono();
    const bus = createEventBus();
    const metrics = createMetricsRegistry();
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      metrics,
    });
    const body = JSON.stringify({
      runId: "1",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        // no signature
      },
      body,
    });
    expect(res.status).toBe(401);
    const text = renderPrometheus(metrics);
    expect(text).toMatch(
      /showcase_ops_webhook_rejections\{reason="missing-signature"\}\s+1/,
    );
    // Deprecated alias still populated for HMAC-category reasons —
    // `missing-signature` is in HMAC_REASONS.
    expect(text).toMatch(
      /showcase_ops_hmac_failures\{reason="missing-signature"\}\s+1/,
    );
  });

  it("increments webhook_rejections with reason=invalid-json on bad body (NOT mirrored to hmac_failures)", async () => {
    const app = new Hono();
    const bus = createEventBus();
    const metrics = createMetricsRegistry();
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      metrics,
    });
    const body = "not-json";
    const canonical = canonicalPayload("POST", PATH, String(NOW), body);
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body,
    });
    expect(res.status).toBe(400);
    const text = renderPrometheus(metrics);
    expect(text).toMatch(
      /showcase_ops_webhook_rejections\{reason="invalid-json"\}\s+1/,
    );
    // invalid-json is NOT an HMAC-verify reason — hmac_failures must not be
    // bumped for this category (it's a body-decode fault, post-verify).
    expect(text).not.toMatch(
      /showcase_ops_hmac_failures\{reason="invalid-json"\}/,
    );
  });

  it("increments webhook_rejections with reason=invalid-payload when schema rejects", async () => {
    const app = new Hono();
    const bus = createEventBus();
    const metrics = createMetricsRegistry();
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      metrics,
    });
    const body = JSON.stringify({ runId: "1" }); // missing required fields
    const canonical = canonicalPayload("POST", PATH, String(NOW), body);
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body,
    });
    expect(res.status).toBe(400);
    const text = renderPrometheus(metrics);
    expect(text).toMatch(
      /showcase_ops_webhook_rejections\{reason="invalid-payload"\}\s+1/,
    );
  });
});

describe("POST /webhooks/deploy — gateSkipped pass-through", () => {
  it("accepts gateSkipped: true and propagates to the emitted event", async () => {
    const { app, seen } = buildApp();
    const payload = JSON.stringify({
      runId: "gate-1",
      services: ["a", "b"],
      failed: [],
      succeeded: [],
      cancelled: false,
      gateSkipped: true,
    });
    const { headers, body } = signed(payload);
    const res = await app.request(PATH, { method: "POST", headers, body });
    expect(res.status).toBe(202);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.gateSkipped).toBe(true);
  });

  it("accepts payload without gateSkipped and emits undefined", async () => {
    const { app, seen } = buildApp();
    const payload = JSON.stringify({
      runId: "gate-0",
      services: ["a"],
      failed: [],
      succeeded: ["a"],
      cancelled: false,
    });
    const { headers, body } = signed(payload);
    const res = await app.request(PATH, { method: "POST", headers, body });
    expect(res.status).toBe(202);
    expect(seen[0]!.gateSkipped).toBeUndefined();
  });

  it("rejects non-boolean gateSkipped with 400 (strict schema)", async () => {
    const { app } = buildApp();
    const payload = JSON.stringify({
      runId: "gate-bad",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
      gateSkipped: "yes",
    });
    const { headers, body } = signed(payload);
    const res = await app.request(PATH, { method: "POST", headers, body });
    expect(res.status).toBe(400);
  });
});

describe("POST /webhooks/deploy — idempotency", () => {
  it("returns 200 (not 202) on duplicate runId and does NOT re-emit", async () => {
    const { app, seen } = buildApp();
    const payload = JSON.stringify({
      runId: "dup-1",
      services: ["a"],
      failed: [],
      succeeded: ["a"],
      cancelled: false,
    });
    const { headers, body } = signed(payload);
    const first = await app.request(PATH, { method: "POST", headers, body });
    expect(first.status).toBe(202);
    // Identical payload + identical NOW means the signature is identical
    // too — we're exercising the dedupe path, which runs AFTER signature
    // verification and keys on runId rather than anything timestamp-
    // dependent. (Previous comment here claimed "re-sign with a fresh
    // timestamp"; that was misleading since the test reuses NOW.)
    const second = signed(payload);
    const res = await app.request(PATH, {
      method: "POST",
      headers: second.headers,
      body: second.body,
    });
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { ok: boolean; duplicate: boolean };
    expect(parsed.duplicate).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("treats runIds independently — different runId always emits", async () => {
    const { app, seen } = buildApp();
    for (const runId of ["r1", "r2", "r3"]) {
      const payload = JSON.stringify({
        runId,
        services: [],
        failed: [],
        succeeded: [],
        cancelled: false,
      });
      const { headers, body } = signed(payload);
      const res = await app.request(PATH, { method: "POST", headers, body });
      expect(res.status).toBe(202);
    }
    expect(seen.map((e) => e.runId)).toEqual(["r1", "r2", "r3"]);
  });

  it("honors dedupeSize=0 (disabled) — all posts re-emit", async () => {
    const app = new Hono();
    const bus = createEventBus();
    const seen: DeployResultEvent[] = [];
    bus.on("deploy.result", (e) => seen.push(e));
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      dedupeSize: 0,
    });
    const payload = JSON.stringify({
      runId: "same",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    for (let i = 0; i < 3; i += 1) {
      const { headers, body } = signed(payload);
      const res = await app.request(PATH, { method: "POST", headers, body });
      expect(res.status).toBe(202);
    }
    expect(seen).toHaveLength(3);
  });

  it("touch-on-read: frequently-seen runId survives eviction pressure", async () => {
    // Regression: the dedupe cache comment claimed "re-seeing refreshes LRU"
    // but the prior implementation only touched on `record()` (first-seen),
    // so a hot id would get evicted just like a cold one. We now touch on
    // read too — exercise it by filling past capacity and confirming the
    // hot id still deduplicates.
    const app = new Hono();
    const bus = createEventBus();
    const seen: DeployResultEvent[] = [];
    bus.on("deploy.result", (e) => seen.push(e));
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      dedupeSize: 3,
    });
    async function post(runId: string): Promise<number> {
      const body = JSON.stringify({
        runId,
        services: [],
        failed: [],
        succeeded: [],
        cancelled: false,
      });
      const { headers, body: b } = signed(body);
      const res = await app.request(PATH, {
        method: "POST",
        headers,
        body: b,
      });
      return res.status;
    }
    // Insert "hot" then fill the cache with cold ids, re-reading "hot"
    // each round so touch-on-read moves it to the tail.
    expect(await post("hot")).toBe(202);
    for (const cold of ["c1", "c2"]) {
      expect(await post(cold)).toBe(202);
      // Re-post "hot" as a duplicate — should be dedup'd (200) AND re-
      // promoted by touch-on-read.
      expect(await post("hot")).toBe(200);
    }
    // Add enough cold ids to overflow cap — hot must still be dedup'd.
    expect(await post("c3")).toBe(202);
    expect(await post("c4")).toBe(202);
    // If hot had been evicted, this would re-emit (202). With touch-on-
    // read + eviction victim being the least-recent non-hot id, hot
    // remains and we get 200.
    expect(await post("hot")).toBe(200);
    // Hot emitted once total.
    expect(seen.filter((e) => e.runId === "hot")).toHaveLength(1);
  });
});

describe("POST /webhooks/deploy — webhookPath override", () => {
  it("honors webhookPath override when signer signs a proxy-mounted path", async () => {
    const app = new Hono();
    const bus = createEventBus();
    const seen: DeployResultEvent[] = [];
    bus.on("deploy.result", (e) => seen.push(e));
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      webhookPath: "/proxy/webhooks/deploy",
    });
    const payload = JSON.stringify({
      runId: "proxy-1",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    // Sender signs the externally-visible path, not the internal route.
    const canonical = canonicalPayload(
      "POST",
      "/proxy/webhooks/deploy",
      String(NOW),
      payload,
    );
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body: payload,
    });
    expect(res.status).toBe(202);
    expect(seen).toHaveLength(1);
  });

  it("rejects when webhookPath override doesn't match the signer", async () => {
    const app = new Hono();
    const bus = createEventBus();
    registerDeployWebhook(app, {
      bus,
      logger,
      secrets: [SECRET],
      nowSec: () => NOW,
      webhookPath: "/proxy/webhooks/deploy",
    });
    const payload = JSON.stringify({
      runId: "proxy-bad",
      services: [],
      failed: [],
      succeeded: [],
      cancelled: false,
    });
    // Sender signs the literal route — mismatch with the configured path.
    const canonical = canonicalPayload("POST", PATH, String(NOW), payload);
    const sig = computeSignature(SECRET, canonical);
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature": `sha256=${sig}`,
      },
      body: payload,
    });
    expect(res.status).toBe(401);
  });
});
