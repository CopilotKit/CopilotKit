import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  TELEMETRY_DOCS_URL,
  TELEMETRY_EVENTS,
  TELEMETRY_INGEST_URL,
  getRuntimeUrlType,
  getTelemetryDistinctIdForUrl,
  maybeShowDisclosure,
  track,
  trackBannerClicked,
  trackBannerViewed,
  trackTalkToEngineerClicked,
  trackThreadsEmptyEnabledViewed,
  trackThreadsEnabledViewed,
  trackThreadsIntelligenceSignupClicked,
  trackThreadsLockedViewed,
  trackThreadsTabClicked,
  trackThreadsTalkToEngineerClicked,
} from "../telemetry.js";
import {
  _resetTelemetryPersistenceForTesting,
  getOrCreateTelemetryDistinctId,
  hasTelemetryDisclosureBeenShown,
  isTelemetryOptedOut,
  markTelemetryDisclosureShown,
  setTelemetryOptOut,
} from "../persistence.js";

// The wrapper short-circuits before any network call when opted out, but
// for the network-touching cases we mock fetch globally so we can read
// what would have been sent without making real HTTP requests.
let fetchMock: MockInstance<typeof fetch>;
let consoleInfoSpy: MockInstance<typeof console.info>;
const webInspectorPackage = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { version: string };

beforeEach(() => {
  // Each test starts from a clean localStorage so distinct-ID + opt-out
  // + disclosure-shown flags don't leak across cases.
  window.localStorage.clear();
  _resetTelemetryPersistenceForTesting();

  // The wrapper POSTs via globalThis.fetch with a 3s AbortController
  // timeout. Stub it with a resolving Response so happy-path sends
  // complete synchronously (the wrapper does `void` on the promise).
  fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));

  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Wire body shape ────────────────────────────────────────────────────────

describe("track()", () => {
  it("posts to telemetry.copilotkit.ai/ingest with confirmed IngestPayload shape", async () => {
    track(TELEMETRY_EVENTS.bannerViewed, {
      banner_id: "2025-05-01T00:00:00Z",
    });

    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(TELEMETRY_INGEST_URL);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(
      (init?.headers as Record<string, string>)["X-CopilotKit-Telemetry-Id"],
    ).toMatch(/^[0-9a-f-]{36}$/);

    // Ben confirmed shape (telemetry-sink-ingest/index.ts:127-134):
    // package is a top-level object { name, version? }, NOT inside properties.
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
      package: { name: string; version?: string };
      ts: number;
    };
    expect(body.event).toBe("oss.inspector.banner_viewed");
    expect(body.properties.banner_id).toBe("2025-05-01T00:00:00Z");
    expect(typeof body.properties.distinct_id).toBe("string");
    // package is top-level object, not a string inside properties
    expect(body.package).toEqual({ name: "@copilotkit/web-inspector" });
    expect(body.properties).not.toHaveProperty("package");
    expect(body.properties).not.toHaveProperty("package_name");
    expect(body.properties).not.toHaveProperty("inspector_distinct_id");
    expect(typeof body.ts).toBe("number");
  });

  it("short-circuits when localStorage opt-out is set", async () => {
    setTelemetryOptOut(true);
    expect(isTelemetryOptedOut()).toBe(true);

    track(TELEMETRY_EVENTS.bannerClicked, {
      banner_id: "x",
      cta: "body",
    });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows unserializable properties before dispatching", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => track(TELEMETRY_EVENTS.bannerClicked, circular)).not.toThrow();
    expect(() =>
      track(TELEMETRY_EVENTS.bannerClicked, { value: 1n }),
    ).not.toThrow();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows fetch failures (telemetry is best-effort)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    expect(() => track(TELEMETRY_EVENTS.threadsTabClicked)).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("does not send when fetch is unavailable (SSR / pre-fetch environment)", async () => {
    vi.stubGlobal("fetch", undefined);

    expect(() =>
      track(TELEMETRY_EVENTS.bannerViewed, { banner_id: "abc" }),
    ).not.toThrow();

    // No fetch call possible — restore happens in afterEach via unstubAllGlobals
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes message content or agent state in the payload", async () => {
    track(TELEMETRY_EVENTS.bannerViewed, { banner_id: "abc" });
    await Promise.resolve();

    const [, init] = fetchMock.mock.calls[0]!;
    const raw = (init?.body as string) ?? "{}";
    // Forbidden content keys (privacy invariant — never send inspector content)
    expect(raw).not.toMatch(
      /messages|completion|prompt|state_snapshot|agent_state|content|user_id/i,
    );
  });
});

// ─── Typed per-event helpers ─────────────────────────────────────────────────

describe("typed helpers", () => {
  it("trackBannerViewed sends banner_id and optional cta_label", async () => {
    trackBannerViewed({ banner_id: "ts-2025", cta_label: "Try threads" });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body.event).toBe(TELEMETRY_EVENTS.bannerViewed);
    expect(body.properties.banner_id).toBe("ts-2025");
    expect(body.properties.cta_label).toBe("Try threads");
  });

  it("trackBannerViewed omits cta_label when undefined (JSON.stringify drops it)", async () => {
    trackBannerViewed({ banner_id: "ts-2025" });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const raw = (init?.body as string) ?? "{}";
    expect(raw).not.toContain("cta_label");
  });

  it("trackBannerClicked sends banner_id, cta, and optional cta_label", async () => {
    trackBannerClicked({ banner_id: "ts-2025", cta: "body" });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body.event).toBe(TELEMETRY_EVENTS.bannerClicked);
    expect(body.properties.banner_id).toBe("ts-2025");
    expect(body.properties.cta).toBe("body");
  });

  it("trackThreadsTabClicked sends thread metadata without content", async () => {
    trackThreadsTabClicked({
      intelligence_status: "intelligence_not_enabled",
      thread_service_status: "unavailable",
      runtime_mode: "sse",
      runtime_url_type: "localhost",
      license_status: "none",
      telemetry_disabled: false,
    });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
      package: { name: string; version?: string };
    };
    expect(body.event).toBe(TELEMETRY_EVENTS.threadsTabClicked);
    expect(body.properties).toMatchObject({
      intelligence_status: "intelligence_not_enabled",
      thread_service_status: "unavailable",
      runtime_mode: "sse",
      runtime_url_type: "localhost",
      license_status: "none",
      telemetry_disabled: false,
      package_name: "@copilotkit/web-inspector",
      package_version: webInspectorPackage.version,
    });
    expect(body.properties).toHaveProperty("inspector_distinct_id");
    expect(body.properties.inspector_distinct_id).toBe(
      body.properties.distinct_id,
    );
    expect(body.package).toEqual({
      name: "@copilotkit/web-inspector",
      version: webInspectorPackage.version,
    });
  });

  it("sends required threads CTA and viewed events", async () => {
    trackThreadsLockedViewed({
      intelligence_status: "intelligence_not_enabled",
      thread_service_status: "unavailable",
    });
    trackThreadsIntelligenceSignupClicked({
      cta: "signup",
      cta_surface: "threads_locked",
      posthog_distinct_id: "abc-123",
    });
    trackThreadsTalkToEngineerClicked({
      cta: "talk_to_engineer",
      cta_surface: "threads_locked",
      posthog_distinct_id: "abc-123",
    });
    trackTalkToEngineerClicked({
      cta: "talk_to_engineer",
      cta_surface: "threads_header",
      posthog_distinct_id: "abc-123",
    });
    trackThreadsEmptyEnabledViewed({
      intelligence_status: "intelligence_enabled",
      thread_service_status: "available",
      thread_count: 0,
    });
    trackThreadsEnabledViewed({
      intelligence_status: "intelligence_enabled",
      thread_service_status: "available",
      thread_count: 2,
    });

    await Promise.resolve();

    const payloads = fetchMock.mock.calls.map(([, init]) => {
      return JSON.parse((init?.body as string) ?? "{}") as {
        event: string;
        properties: Record<string, unknown>;
      };
    });
    const events = payloads.map((payload) => payload.event);
    expect(events).toEqual([
      TELEMETRY_EVENTS.threadsLockedViewed,
      TELEMETRY_EVENTS.threadsIntelligenceSignupClicked,
      TELEMETRY_EVENTS.threadsTalkToEngineerClicked,
      TELEMETRY_EVENTS.talkToEngineerClicked,
      TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
      TELEMETRY_EVENTS.threadsEnabledViewed,
    ]);
    expect(payloads[0]!.properties).toMatchObject({
      intelligence_status: "intelligence_not_enabled",
      thread_service_status: "unavailable",
    });
    expect(payloads[1]!.properties).toMatchObject({
      cta: "signup",
      cta_surface: "threads_locked",
      posthog_distinct_id: "abc-123",
    });
    expect(payloads[2]!.properties).toMatchObject({
      cta: "talk_to_engineer",
      cta_surface: "threads_locked",
      posthog_distinct_id: "abc-123",
    });
    expect(payloads[3]!.properties).toMatchObject({
      cta: "talk_to_engineer",
      cta_surface: "threads_header",
      posthog_distinct_id: "abc-123",
    });
    expect(payloads[4]!.properties).toMatchObject({
      intelligence_status: "intelligence_enabled",
      thread_service_status: "available",
      thread_count: 0,
    });
    expect(payloads[5]!.properties).toMatchObject({
      intelligence_status: "intelligence_enabled",
      thread_service_status: "available",
      thread_count: 2,
    });
  });
});

// ─── Safe URL classification ────────────────────────────────────────────────

describe("getRuntimeUrlType()", () => {
  it("classifies runtime URLs without exposing origins", () => {
    expect(getRuntimeUrlType(undefined)).toBe("missing");
    expect(getRuntimeUrlType("/api/copilotkit")).toBe("relative");
    expect(getRuntimeUrlType("http://localhost:4000")).toBe("localhost");
    expect(getRuntimeUrlType("https://example.com/api")).toBe("remote");
  });
});

// ─── Distinct ID lifecycle ───────────────────────────────────────────────────

describe("distinct ID lifecycle", () => {
  it("persists across calls within the same session", () => {
    const first = getOrCreateTelemetryDistinctId();
    const second = getOrCreateTelemetryDistinctId();
    expect(first).toBe(second);
    expect(
      window.localStorage.getItem("cpk:inspector:telemetry:distinct_id"),
    ).toBe(first);
  });

  it("generates a UUID-v4-shaped value", () => {
    const id = getOrCreateTelemetryDistinctId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns a UUID without throwing in SSR (window undefined)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => getOrCreateTelemetryDistinctId()).not.toThrow();
    const id = getOrCreateTelemetryDistinctId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns a UUID without throwing when localStorage.getItem throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => getOrCreateTelemetryDistinctId()).not.toThrow();
    const id = getOrCreateTelemetryDistinctId();
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("returns the same UUID across calls when localStorage throws (funnel coherence)", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const first = getOrCreateTelemetryDistinctId();
    const second = getOrCreateTelemetryDistinctId();
    expect(first).toBe(second);
  });
});

// ─── Persistence error-resilience ───────────────────────────────────────────

describe("persistence error-resilience", () => {
  it("isTelemetryOptedOut returns false (not disabled) when localStorage throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    // Must fail to "not opted out" — if it returned true, all users in
    // restricted-storage contexts would have telemetry silently disabled.
    expect(isTelemetryOptedOut()).toBe(false);
  });

  it("setTelemetryOptOut does not throw when localStorage.setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => setTelemetryOptOut(true)).not.toThrow();
  });

  it("markTelemetryDisclosureShown does not throw when localStorage.setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    // Failure means the disclosure fires on every mount instead of once —
    // a UX regression, not a data leak. The important invariant is no throw.
    expect(() => markTelemetryDisclosureShown()).not.toThrow();
  });
});

// ─── maybeShowDisclosure() ───────────────────────────────────────────────────

describe("maybeShowDisclosure()", () => {
  it("logs once and sets the disclosure-shown flag", () => {
    maybeShowDisclosure();
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const [message] = consoleInfoSpy.mock.calls[0]!;
    expect(message).toContain(TELEMETRY_DOCS_URL);
    expect(hasTelemetryDisclosureBeenShown()).toBe(true);

    maybeShowDisclosure();
    // No second log — flag short-circuits.
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
  });

  it("does not log when the user is already opted out", () => {
    setTelemetryOptOut(true);

    maybeShowDisclosure();

    expect(consoleInfoSpy).not.toHaveBeenCalled();
    // The flag stays unset so a future opt-in flips back to "first run"
    // behavior — see the wrapper's design comment.
    expect(hasTelemetryDisclosureBeenShown()).toBe(false);
  });
});

// ─── getTelemetryDistinctIdForUrl() ─────────────────────────────────────────

describe("getTelemetryDistinctIdForUrl()", () => {
  it("returns the persisted distinct-ID when not opted out", () => {
    const id = getTelemetryDistinctIdForUrl();
    expect(id).not.toBeNull();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // Same ID across calls — ensures URL propagation matches the ID
    // that goes on event sends.
    expect(getTelemetryDistinctIdForUrl()).toBe(id);
  });

  it("returns null when the user is opted out (no cross-domain leak)", () => {
    setTelemetryOptOut(true);
    expect(getTelemetryDistinctIdForUrl()).toBeNull();
  });
});

// ─── Opt-out round-trip ──────────────────────────────────────────────────────

describe("opt-out round-trip", () => {
  it("setTelemetryOptOut(true) → isTelemetryOptedOut() is true", () => {
    expect(isTelemetryOptedOut()).toBe(false);
    setTelemetryOptOut(true);
    expect(isTelemetryOptedOut()).toBe(true);
    setTelemetryOptOut(false);
    expect(isTelemetryOptedOut()).toBe(false);
  });
});
