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
  trackErrorSignalViewed,
  trackInspectorOpened,
  trackTalkToEngineerClicked,
  trackThreadsEmptyEnabledViewed,
  trackThreadsEnabledViewed,
  trackThreadsIntelligenceSignupClicked,
  trackThreadsLockedViewed,
  trackThreadsTabClicked,
  trackThreadsTalkToEngineerClicked,
  trackWhatsNewClicked,
  trackWhatsNewSignalViewed,
  trackWhatsNewViewed,
} from "../telemetry.js";
import {
  _resetTelemetryPersistenceForTesting,
  clearLegacyAnnouncementReadState,
  getOrCreateTelemetryDistinctId,
  hasTelemetryDisclosureBeenShown,
  isTelemetryOptedOut,
  loadAnnouncementPulsedTimestamp,
  loadAnnouncementReadTimestamp,
  markTelemetryDisclosureShown,
  saveAnnouncementPulsedTimestamp,
  saveAnnouncementReadTimestamp,
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
    track(TELEMETRY_EVENTS.whatsNewViewed, {
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
    expect(body.event).toBe("oss.inspector.whats_new_viewed");
    expect(body.properties.banner_id).toBe("2025-05-01T00:00:00Z");
    expect(typeof body.properties.distinct_id).toBe("string");
    // package is top-level object, not a string inside properties
    expect(body.package).toEqual({
      name: "@copilotkit/web-inspector",
      version: webInspectorPackage.version,
    });
    expect(body.properties).not.toHaveProperty("package");
    expect(typeof body.ts).toBe("number");
  });

  it("short-circuits when localStorage opt-out is set", async () => {
    setTelemetryOptOut(true);
    expect(isTelemetryOptedOut()).toBe(true);

    track(TELEMETRY_EVENTS.whatsNewClicked, {
      banner_id: "x",
      cta: "body",
    });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows unserializable properties before dispatching", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      track(TELEMETRY_EVENTS.whatsNewClicked, circular),
    ).not.toThrow();
    expect(() =>
      track(TELEMETRY_EVENTS.whatsNewClicked, { value: 1n }),
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
      track(TELEMETRY_EVENTS.whatsNewViewed, { banner_id: "abc" }),
    ).not.toThrow();

    // No fetch call possible — restore happens in afterEach via unstubAllGlobals
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes message content or agent state in the payload", async () => {
    track(TELEMETRY_EVENTS.whatsNewViewed, { banner_id: "abc" });
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
  it("trackWhatsNewViewed sends banner_id, surface, and optional cta_label", async () => {
    trackWhatsNewViewed({
      banner_id: "ts-2025",
      surface: "whats_new",
      cta_label: "Try threads",
    });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body.event).toBe(TELEMETRY_EVENTS.whatsNewViewed);
    expect(body.properties.banner_id).toBe("ts-2025");
    expect(body.properties.surface).toBe("whats_new");
    expect(body.properties.cta_label).toBe("Try threads");
    // What's new is enriched like every other event — the flat shape the
    // retired banner events used no longer exists.
    expect(body.properties).toMatchObject({
      package_name: "@copilotkit/web-inspector",
      package_version: webInspectorPackage.version,
    });
    expect(body.properties.inspector_distinct_id).toBe(
      body.properties.distinct_id,
    );
  });

  it("trackWhatsNewSignalViewed records the launcher presentation", async () => {
    trackWhatsNewSignalViewed({
      banner_id: "ts-2025",
      surface: "launcher",
      presentation: "animated",
    });
    await Promise.resolve();

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body.event).toBe("oss.inspector.whats_new_signal_viewed");
    expect(body.properties).toMatchObject({
      banner_id: "ts-2025",
      surface: "launcher",
      presentation: "animated",
      package_name: "@copilotkit/web-inspector",
      package_version: webInspectorPackage.version,
    });
  });

  it("trackWhatsNewViewed omits cta_label when undefined (JSON.stringify drops it)", async () => {
    trackWhatsNewViewed({ banner_id: "ts-2025", surface: "whats_new" });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const raw = (init?.body as string) ?? "{}";
    expect(raw).not.toContain("cta_label");
  });

  it("trackInspectorOpened sends open_source and is enriched with package identity", async () => {
    trackInspectorOpened({
      open_source: "floating_button",
      license_status: "none",
      runtime_mode: "sse",
      runtime_url_type: "localhost",
      has_unseen_announcement: true,
    });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
      package: { name: string; version?: string };
    };
    expect(body.event).toBe("oss.inspector.opened");
    expect(body.properties).toMatchObject({
      open_source: "floating_button",
      license_status: "none",
      runtime_mode: "sse",
      runtime_url_type: "localhost",
      has_unseen_announcement: true,
      package_name: "@copilotkit/web-inspector",
      package_version: webInspectorPackage.version,
    });
    expect(body.properties.inspector_distinct_id).toBe(
      body.properties.distinct_id,
    );
    expect(body.package).toEqual({
      name: "@copilotkit/web-inspector",
      version: webInspectorPackage.version,
    });
  });

  it("trackErrorSignalViewed sends the failure class, the presentation and whether a pill was shown", async () => {
    trackErrorSignalViewed({
      source: "connection",
      presentation: "animated",
      label: "shown",
    });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body.event).toBe("oss.inspector.error_signal_viewed");
    expect(body.properties).toMatchObject({
      source: "connection",
      presentation: "animated",
      label: "shown",
    });
  });

  it("trackErrorSignalViewed refuses to forward anything but its three enums", async () => {
    // The one place a later change could casually attach a free-text field.
    // The helper rebuilds its payload, so extra keys cannot ride along.
    trackErrorSignalViewed({
      source: "threads",
      presentation: "reduced_motion",
      label: "suppressed",
      // @ts-expect-error - deliberately passing a field the helper must drop
      message: "ECONNREFUSED http://localhost:4000/api/copilotkit",
    });
    await Promise.resolve();
    const raw = (fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}";
    expect(raw).not.toContain("ECONNREFUSED");
    expect(raw).not.toContain("localhost:4000");
    expect(raw).not.toContain("message");
    const properties = (
      JSON.parse(raw) as { properties: Record<string, unknown> }
    ).properties;
    expect(properties.source).toBe("threads");
    expect(properties.presentation).toBe("reduced_motion");
    expect(properties.label).toBe("suppressed");
  });

  it("trackErrorSignalViewed sends nothing when the user has opted out", async () => {
    setTelemetryOptOut(true);
    trackErrorSignalViewed({
      source: "connection",
      presentation: "animated",
      label: "shown",
    });
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trackInspectorOpened carries the error signal and its class", async () => {
    trackInspectorOpened({
      open_source: "floating_button",
      has_unseen_announcement: false,
      has_error_signal: true,
      error_signal_source: "threads",
    });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const properties = (
      JSON.parse((init?.body as string) ?? "{}") as {
        properties: Record<string, unknown>;
      }
    ).properties;
    expect(properties).toMatchObject({
      has_error_signal: true,
      error_signal_source: "threads",
    });
  });

  it("opened and What's new events carry no message, state, or announcement content", async () => {
    trackInspectorOpened({ open_source: "floating_button" });
    trackWhatsNewViewed({
      banner_id: "ts-2025",
      surface: "whats_new",
    });
    await Promise.resolve();
    for (const [, init] of fetchMock.mock.calls) {
      const properties = (
        JSON.parse((init?.body as string) ?? "{}") as {
          properties: Record<string, unknown>;
        }
      ).properties;
      // Allow-list assertion: any new key has to be added here deliberately,
      // so an accidental content/PII payload fails the test instead of
      // shipping.
      const allowed = new Set([
        "open_source",
        "banner_id",
        "surface",
        "distinct_id",
        "inspector_distinct_id",
        "package_name",
        "package_version",
      ]);
      expect(Object.keys(properties).filter((k) => !allowed.has(k))).toEqual(
        [],
      );
    }
  });

  it("trackWhatsNewClicked sends banner_id, cta, and optional cta_label", async () => {
    trackWhatsNewClicked({ banner_id: "ts-2025", cta: "body" });
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body.event).toBe(TELEMETRY_EVENTS.whatsNewClicked);
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
      has_threads: false,
      usage_bucket: "empty",
      expiry_bucket: "zero",
      group_key: "workbench",
      leaf_key: "threads",
    });
    trackThreadsEnabledViewed({
      intelligence_status: "intelligence_enabled",
      thread_service_status: "available",
      has_threads: true,
      usage_bucket: "within_limit",
      expiry_bucket: "positive",
      group_key: "workbench",
      leaf_key: "threads",
    });

    await Promise.resolve();

    const payloads = fetchMock.mock.calls.map(([, init]) => {
      return JSON.parse((init?.body as string) ?? "{}") as {
        event: string;
        properties: Record<string, unknown>;
      };
    });
    const hasThreads = payloads.map(({ properties }) => properties.has_threads);
    const events = payloads.map((payload) => payload.event);
    expect(events).toEqual([
      TELEMETRY_EVENTS.threadsLockedViewed,
      TELEMETRY_EVENTS.threadsIntelligenceSignupClicked,
      TELEMETRY_EVENTS.threadsTalkToEngineerClicked,
      TELEMETRY_EVENTS.talkToEngineerClicked,
      TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
      TELEMETRY_EVENTS.threadsEnabledViewed,
    ]);
    expect(hasThreads.slice(4), "has_threads").toEqual([false, true]);
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
    expect(payloads[2]!.properties).not.toHaveProperty("has_threads");
    expect(payloads[3]!.properties).toMatchObject({
      cta: "talk_to_engineer",
      cta_surface: "threads_header",
      posthog_distinct_id: "abc-123",
    });
    expect(payloads[4]!.properties).toMatchObject({
      intelligence_status: "intelligence_enabled",
      thread_service_status: "available",
      has_threads: false,
      usage_bucket: "empty",
      expiry_bucket: "zero",
      group_key: "workbench",
      leaf_key: "threads",
    });
    expect(payloads[5]!.properties).toMatchObject({
      intelligence_status: "intelligence_enabled",
      thread_service_status: "available",
      has_threads: true,
      usage_bucket: "within_limit",
      expiry_bucket: "positive",
      group_key: "workbench",
      leaf_key: "threads",
    });
  });
});

// ─── Event catalogue ────────────────────────────────────────────────────────

describe("event catalogue", () => {
  // The announcement rename is a hard cut: the bubble and the in-panel card
  // that fired the `banner_*` events no longer exist, so emitting those names
  // from the new trigger would populate the historical series with
  // differently-meaning data.
  it("has retired the banner events and replaced them with What's new", () => {
    const names = Object.values(TELEMETRY_EVENTS) as string[];

    expect(names.filter((name) => name.includes("banner"))).toEqual([]);
    expect(names).toContain("oss.inspector.whats_new_viewed");
    expect(names).toContain("oss.inspector.whats_new_signal_viewed");
    expect(names).toContain("oss.inspector.error_signal_viewed");
    expect(names).toContain("oss.inspector.whats_new_clicked");
    expect(names.filter((name) => name.includes("dismissed"))).toEqual([
      // The example tour keeps its own dismissal; the announcement's is gone.
      "oss.inspector.threads_example_tour_dismissed",
    ]);
  });

  it("holds twenty-four event names, all under the owned oss.inspector prefix", () => {
    const names = Object.values(TELEMETRY_EVENTS) as string[];

    expect(names).toHaveLength(24);
    expect(names.filter((name) => !name.startsWith("oss.inspector."))).toEqual(
      [],
    );
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

// ─── Announcement read state (host-scoped) ──────────────────────────────────

/**
 * Same host, different port. localStorage is partitioned by origin — which
 * includes the port — so its store starts empty, while the cookie jar is keyed
 * by host and survives. Everything the read state has to do is a consequence
 * of that asymmetry.
 */
function moveToAnotherLocalhostPort(): void {
  window.localStorage.clear();
}

/** A browser that blocks cookies: writes are dropped, reads come back empty. */
function blockCookies(): void {
  Object.defineProperty(document, "cookie", {
    get: () => "",
    set: () => {},
    configurable: true,
  });
}

describe("announcement read state", () => {
  it("reports nothing read before anything is read", () => {
    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("stays read after moving to another localhost port", () => {
    saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z");

    moveToAnotherLocalhostPort();

    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-19T10:00:00.000Z");
  });

  it("reports the announcement it was last given, so a newer one reads as unread", () => {
    saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z");
    saveAnnouncementReadTimestamp("2026-08-20T10:00:00.000Z");

    moveToAnotherLocalhostPort();

    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-20T10:00:00.000Z");
  });

  it("degrades to per-port memory when cookies are blocked", () => {
    blockCookies();

    expect(() =>
      saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z"),
    ).not.toThrow();
    // Still remembered on the port the developer is working on…
    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-19T10:00:00.000Z");

    // …and re-armed on the next one, which is the documented degradation.
    moveToAnotherLocalhostPort();
    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("ignores a malformed stored value instead of throwing", () => {
    document.cookie = "cpk_inspector_announcements=%7Bnot-json";

    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("does not throw when cookie access itself throws", () => {
    // Sandboxed documents throw on `document.cookie` rather than returning
    // an empty string, which must degrade to the mirror just as quietly.
    Object.defineProperty(document, "cookie", {
      get: () => {
        throw new DOMException("SecurityError");
      },
      set: () => {
        throw new DOMException("SecurityError");
      },
      configurable: true,
    });

    expect(() =>
      saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z"),
    ).not.toThrow();
    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-19T10:00:00.000Z");
  });

  it("does not throw in SSR (window undefined)", () => {
    vi.stubGlobal("window", undefined);

    expect(() => saveAnnouncementReadTimestamp("ts")).not.toThrow();
    expect(() => loadAnnouncementReadTimestamp()).not.toThrow();
  });
});

// ─── Pulse suppression (per browser tab) ────────────────────────────────────

describe("announcement pulse suppression", () => {
  it("reports nothing pulsed in a fresh tab", () => {
    expect(loadAnnouncementPulsedTimestamp()).toBeNull();
  });

  // Deliberately the timestamp and not a boolean: a boolean would swallow a
  // newly published announcement for the rest of the tab's life.
  it("records which announcement the tab pulsed for", () => {
    saveAnnouncementPulsedTimestamp("2026-08-19T10:00:00.000Z");
    expect(loadAnnouncementPulsedTimestamp()).toBe("2026-08-19T10:00:00.000Z");

    saveAnnouncementPulsedTimestamp("2026-08-20T10:00:00.000Z");
    expect(loadAnnouncementPulsedTimestamp()).toBe("2026-08-20T10:00:00.000Z");
  });

  it("is not shared with the read state, which outlives the tab", () => {
    saveAnnouncementPulsedTimestamp("2026-08-19T10:00:00.000Z");

    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("does not throw when sessionStorage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("SecurityError");
      },
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
    });

    expect(() => saveAnnouncementPulsedTimestamp("ts")).not.toThrow();
    // Losing the suppression costs one extra pulse, never correctness.
    expect(loadAnnouncementPulsedTimestamp()).toBeNull();
  });
});

// ─── One-time reset of the superseded read state ────────────────────────────

describe("legacy announcement read state", () => {
  const LEGACY_KEY = "cpk:inspector:announcements";

  it("is deleted rather than migrated, so every user is re-armed once", () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ timestamp: "2026-08-01T10:00:00.000Z" }),
    );

    clearLegacyAnnouncementReadState();

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("cannot resurrect the value once a new announcement is read", () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ timestamp: "2026-08-01T10:00:00.000Z" }),
    );

    clearLegacyAnnouncementReadState();
    saveAnnouncementReadTimestamp("2026-08-20T10:00:00.000Z");
    clearLegacyAnnouncementReadState();

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-20T10:00:00.000Z");
  });

  it("is safe on every startup, with or without a value to remove", () => {
    expect(() => {
      clearLegacyAnnouncementReadState();
      clearLegacyAnnouncementReadState();
    }).not.toThrow();

    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(() => clearLegacyAnnouncementReadState()).not.toThrow();
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
