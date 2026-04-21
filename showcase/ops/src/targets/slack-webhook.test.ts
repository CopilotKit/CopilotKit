import { describe, it, expect } from "vitest";
import { createSlackWebhookTarget } from "./slack-webhook.js";
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
