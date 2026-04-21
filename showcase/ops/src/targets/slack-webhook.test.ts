import { describe, it, expect } from "vitest";
import { aliasToEnvVar, createSlackWebhookTarget } from "./slack-webhook.js";
import { logger } from "../logger.js";
import type { RenderedMessage } from "../types/index.js";

const payload: RenderedMessage = {
  payload: { text: "hello" },
  contentType: "application/json",
};

describe("slack-webhook target", () => {
  it("posts to resolved webhook URL", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://hooks.slack/x");
    expect(calls[0]!.body).toBe('{"text":"hello"}');
  });

  it("throws when webhook env var unset so engine records target-failed (no dedupe poisoning)", async () => {
    // Regression: previously this returned void, which caused the
    // alert engine's sendToTargets helper to treat the missing-env
    // case as a successful send and record a dedupe entry, suppressing
    // real alerts for the rate-limit window.
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({ logger, env: {}, fetchImpl });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/env var for alias "oss_alerts"/);
    expect(called).toBe(0);
  });

  it("throws when webhook alias itself is missing (not just the env var)", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 200 })) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({ logger, env: {}, fetchImpl });
    await expect(
      t.send(payload, { kind: "slack_webhook" }),
    ).rejects.toThrow(/not set/);
  });

  it("ignores HTTP-date Retry-After and falls through to exponential backoff", async () => {
    // RFC 7231 permits Retry-After as either delta-seconds or HTTP-date.
    // Slack incoming webhooks only use delta-seconds, but a misbehaving
    // proxy in front could surface the date form — we parse it as NaN
    // and fall back to exponential backoff rather than stalling forever
    // or throwing a parse error.
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow", {
          status: 429,
          headers: { "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    // Fell back to exponential: 2**1 * 100 = 200ms.
    expect(sleeps[0]).toBe(200);
  });

  it("retries on 5xx with exponential backoff", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) return new Response("", { status: 503 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      maxRetries: 5,
      sleep: async () => {},
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(calls).toBe(3);
  });

  it("does NOT retry on 4xx and throws so engine records target-failed", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("bad", { status: 400 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async () => {},
    });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it("throws on 404 (channel gone) without retry", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("no_service", { status: 404 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async () => {},
    });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });

  it("retries on 429 respecting Retry-After header", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow down", {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(calls).toBe(2);
    expect(sleeps[0]).toBe(2000);
  });

  it("falls back to exponential backoff when 429 has no Retry-After", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response("slow", { status: 429 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(calls).toBe(2);
    // 2**1 * 100 = 200ms
    expect(sleeps[0]).toBe(200);
  });

  it("throws after 5xx exhaustion so engine records target-failed", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("gateway", { status: 502 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      maxRetries: 3,
      sleep: async () => {},
    });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/502/);
    expect(calls).toBe(3);
  });

  it("retries on thrown network errors and eventually throws", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      maxRetries: 3,
      sleep: async () => {},
    });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(3);
  });

  it("recovers when a network error is followed by success", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async () => {},
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(calls).toBe(2);
  });

  it("caps exponential backoff at 30s across all retry paths", async () => {
    // High attempt count exercises 2**attempt * 100 well past the cap.
    // The cap ensures a misbehaving upstream can't stall the alert
    // pipeline for minutes per failed delivery.
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("gateway", { status: 503 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      maxRetries: 12,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/503/);
    // All sleeps must be <= 30_000 ms, and the later ones must have hit
    // the cap (2**9 * 100 = 51200 would exceed it).
    for (const ms of sleeps) {
      expect(ms).toBeLessThanOrEqual(30_000);
    }
    expect(sleeps.some((ms) => ms === 30_000)).toBe(true);
    expect(calls).toBe(12);
  });

  it("throws on unexpected 3xx redirect so engine records target-failed (no silent drop)", async () => {
    // Regression for F3.1: previously the retry loop had no branch for
    // 3xx responses (Slack never emits them, but a misbehaving proxy
    // might). The loop would exhaust, return undefined, and the
    // dispatcher would record the send as successful — poisoning dedupe
    // and dropping the alert silently. We now throw so the engine
    // records a target-failed outcome.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("moved", {
        status: 301,
        headers: { location: "https://evil.example/other" },
      });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async () => {},
    });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/301/);
    // Must NOT retry — 3xx is permanent for our purposes.
    expect(calls).toBe(1);
  });

  // C1 regression: when a caller passed `maxRetries: 0` (e.g. a test or
  // a deliberate "fire-and-forget" wiring), the for-loop never executed
  // and `send` returned `undefined`. The dispatcher treated that as a
  // successful delivery and recorded dedupe state — poisoning the
  // dedupe table for the full rate-limit window. The fix clamps
  // maxAttempts to at least 1 so the loop ALWAYS executes.
  it("clamps maxRetries=0 to at least 1 attempt (never silently returns undefined)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      maxRetries: 0,
      sleep: async () => {},
    });
    // Must either succeed deterministically (attempt executed) or throw
    // — never resolve to `undefined` from a silent no-op loop.
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(calls).toBe(1);
  });

  it("clamps maxRetries=0 and still throws on 5xx (defense-in-depth)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("gw", { status: 503 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      maxRetries: 0,
      sleep: async () => {},
    });
    await expect(
      t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" }),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(1);
  });

  // C2 regression: aliases like `oss-alerts` are common in YAML
  // (`webhook: oss-alerts`) but were previously upper-cased as-is,
  // producing `SLACK_WEBHOOK_OSS-ALERTS` — a name Railway's env UI
  // rejects and most shells can't export. The fix normalizes `-` to
  // `_` before upper-casing so kebab-case and snake_case aliases both
  // resolve to the same env var.
  describe("alias normalization (C2)", () => {
    it("aliasToEnvVar replaces dashes with underscores before upper-casing", () => {
      expect(aliasToEnvVar("oss-alerts")).toBe("SLACK_WEBHOOK_OSS_ALERTS");
      expect(aliasToEnvVar("oss_alerts")).toBe("SLACK_WEBHOOK_OSS_ALERTS");
      expect(aliasToEnvVar("OSS-Alerts")).toBe("SLACK_WEBHOOK_OSS_ALERTS");
    });

    it("resolves kebab-case alias to the underscore env var at runtime", async () => {
      const calls: Array<{ url: string }> = [];
      const fetchImpl = (async (input: string | URL | Request) => {
        calls.push({ url: String(input) });
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;
      const t = createSlackWebhookTarget({
        logger,
        env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/kebab" },
        fetchImpl,
      });
      await t.send(payload, { kind: "slack_webhook", webhook: "oss-alerts" });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("https://hooks.slack/kebab");
    });

    it("emits a warn log and throws for aliases that don't match ^[A-Za-z0-9_-]+$", async () => {
      const warnCalls: Array<{ msg: string; meta?: unknown }> = [];
      const errorCalls: Array<{ msg: string; meta?: unknown }> = [];
      const capture = {
        debug: () => {},
        info: () => {},
        warn: (msg: string, meta?: unknown) => {
          warnCalls.push({ msg, meta });
        },
        error: (msg: string, meta?: unknown) => {
          errorCalls.push({ msg, meta });
        },
      };
      const fetchImpl = (async () =>
        new Response("ok", { status: 200 })) as unknown as typeof fetch;
      const t = createSlackWebhookTarget({
        logger: capture,
        env: {},
        fetchImpl,
      });
      await expect(
        t.send(payload, { kind: "slack_webhook", webhook: "oss alerts!" }),
      ).rejects.toThrow(/not set/);
      expect(
        warnCalls.some((c) => c.msg === "slack-webhook.invalid-alias-shape"),
      ).toBe(true);
    });

    it("emits an info log on first resolution showing the resolved env var name", async () => {
      const infoCalls: Array<{ msg: string; meta?: unknown }> = [];
      const capture = {
        debug: () => {},
        info: (msg: string, meta?: unknown) => {
          infoCalls.push({ msg, meta });
        },
        warn: () => {},
        error: () => {},
      };
      const fetchImpl = (async () =>
        new Response("ok", { status: 200 })) as unknown as typeof fetch;
      const t = createSlackWebhookTarget({
        logger: capture,
        env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
        fetchImpl,
      });
      await t.send(payload, { kind: "slack_webhook", webhook: "oss-alerts" });
      const resolved = infoCalls.find(
        (c) => c.msg === "slack-webhook.alias-resolved",
      );
      expect(resolved).toBeDefined();
      expect(resolved!.meta).toMatchObject({
        webhook: "oss-alerts",
        envVar: "SLACK_WEBHOOK_OSS_ALERTS",
      });
      // Second call with same alias should NOT re-emit the info log.
      await t.send(payload, { kind: "slack_webhook", webhook: "oss-alerts" });
      const resolvedCount = infoCalls.filter(
        (c) => c.msg === "slack-webhook.alias-resolved",
      ).length;
      expect(resolvedCount).toBe(1);
    });
  });

  // Bucket-(a) R15: `Retry-After: 0` is legal per RFC 7231 ("retry
  // immediately") but `await sleep(0)` returns on the next microtask
  // and the retry loop spins at CPU speed, burning through maxAttempts
  // in milliseconds. Floor the parsed value at MIN_RETRY_AFTER_MS (100).
  it("floors Retry-After: 0 at 100ms so the retry loop doesn't spin", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
  });

  it("clamps Retry-After values under the 100ms floor up to 100ms", async () => {
    // Retry-After is only spec'd in seconds, so a 50ms value can't be
    // expressed — but a malformed proxy that emits fractional seconds
    // (e.g. "0.05") could parse below the floor. Clamp it up.
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow", {
          status: 429,
          headers: { "retry-after": "0.05" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(sleeps[0]).toBe(100);
  });

  it("caps a huge Retry-After value at 30s", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow", {
          status: 429,
          headers: { "retry-after": "600" }, // 10 minutes — must be capped
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = createSlackWebhookTarget({
      logger,
      env: { SLACK_WEBHOOK_OSS_ALERTS: "https://hooks.slack/x" },
      fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await t.send(payload, { kind: "slack_webhook", webhook: "oss_alerts" });
    expect(sleeps[0]).toBe(30_000);
  });
});
