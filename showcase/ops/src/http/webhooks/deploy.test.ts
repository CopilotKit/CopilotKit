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

  it("rejects payload missing required fields with 400", async () => {
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

  it("increments webhook_rejections on missing headers", async () => {
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
      /showcase_ops_webhook_rejections\{reason="missing-headers"\}\s+1/,
    );
    expect(text).toMatch(
      /showcase_ops_hmac_failures\{reason="missing-headers"\}\s+1/,
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
    // Re-sign with a fresh timestamp so HMAC succeeds again; the dedupe
    // path runs after signature verification.
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
