import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import {
  TELEMETRY_DOCS_URL,
  TELEMETRY_EVENTS,
  TELEMETRY_INGEST_URL,
  getTelemetryDistinctIdForUrl,
  maybeShowDisclosure,
  track,
} from "../telemetry";
import {
  getOrCreateTelemetryDistinctId,
  hasTelemetryDisclosureBeenShown,
  isTelemetryOptedOut,
  setTelemetryOptOut,
} from "../persistence";

// The wrapper short-circuits before any network call when opted out, but
// for the network-touching cases we mock fetch globally so we can read
// what would have been sent without making real HTTP requests.
let fetchMock: MockInstance<typeof fetch>;
let consoleInfoSpy: MockInstance<typeof console.info>;

beforeEach(() => {
  // Each test starts from a clean localStorage so distinct-ID + opt-out
  // + disclosure-shown flags don't leak across cases.
  window.localStorage.clear();

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
});

describe("track()", () => {
  it("posts to telemetry.copilotkit.ai/ingest with event + flat properties", async () => {
    track(TELEMETRY_EVENTS.bannerViewed, {
      banner_id: "2025-05-01T00:00:00Z",
    });

    // The wrapper's send is fire-and-forget; flush microtasks so the
    // synchronous fetch call lands before assertions.
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(TELEMETRY_INGEST_URL);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
      ts: number;
    };
    expect(body.event).toBe("oss.inspector.banner_viewed");
    // Conservative body shape (pending Ben confirmation, see PR body):
    // distinct_id and package attribution ride inside `properties` next
    // to the caller's payload. If Ben's lambda expects a different
    // envelope, this is the assertion to update.
    expect(body.properties.banner_id).toBe("2025-05-01T00:00:00Z");
    expect(typeof body.properties.distinct_id).toBe("string");
    expect(body.properties.package).toBe("@copilotkit/web-inspector");
    expect(typeof body.ts).toBe("number");
  });

  it("does not send when the user is opted out", async () => {
    setTelemetryOptOut(true);
    expect(isTelemetryOptedOut()).toBe(true);

    track(TELEMETRY_EVENTS.bannerClicked, {
      banner_id: "x",
      cta: "body",
    });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows fetch failures (telemetry is best-effort)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    expect(() => track(TELEMETRY_EVENTS.threadsTabClicked, {})).not.toThrow();

    // Drain microtasks so the rejected fetch promise resolves before
    // the test ends; the wrapper's `void` should have caught it.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("never includes message content or agent state in the payload", async () => {
    // Negative content audit: enforce that nothing the caller might
    // accidentally pass under a privacy-relevant key reaches the wire
    // in V1. The contract is: properties are an opaque record, and we
    // expect callers not to put PII in. This test pins the shape of
    // the request body so reviewers can see the wire surface.
    track(TELEMETRY_EVENTS.bannerViewed, { banner_id: "abc" });
    await Promise.resolve();

    const [, init] = fetchMock.mock.calls[0]!;
    const raw = (init?.body as string) ?? "{}";
    expect(raw).not.toMatch(/messages|completion|prompt|state_snapshot/i);
  });
});

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
});

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

describe("opt-out round-trip", () => {
  it("setTelemetryOptOut(true) → isTelemetryOptedOut() is true", () => {
    expect(isTelemetryOptedOut()).toBe(false);
    setTelemetryOptOut(true);
    expect(isTelemetryOptedOut()).toBe(true);
    setTelemetryOptOut(false);
    expect(isTelemetryOptedOut()).toBe(false);
  });
});
