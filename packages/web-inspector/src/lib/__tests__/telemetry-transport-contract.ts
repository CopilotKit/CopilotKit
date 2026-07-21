import { expect, vi } from "vitest";

import webInspectorPackage from "../../../package.json" with { type: "json" };
import {
  getTelemetryDistinctIdForUrl,
  trackBannerClicked,
  trackBannerViewed,
  trackTalkToEngineerClicked,
  trackThreadsIntelligenceSignupClicked,
} from "../telemetry.js";
import {
  _resetTelemetryPersistenceForTesting,
  setTelemetryOptOut,
} from "../persistence.js";

const PERSISTED_BROWSER_ID = "11111111-1111-4111-8111-111111111111";
const FIXED_TELEMETRY_TIME_MS = Date.parse("2026-07-11T12:34:56.000Z");
const FIXED_TELEMETRY_TIME_SECONDS = Math.floor(FIXED_TELEMETRY_TIME_MS / 1000);
const WEBSITE_ALIAS = "existing-website-alias";

// These URL and event-name literals intentionally belong to the test. Importing
// their production constants here would let environment-dependent drift change
// the implementation and its expectation together.
export const CANONICAL_INSPECTOR_TELEMETRY_REQUESTS = [
  {
    url: "https://telemetry.copilotkit.ai/ingest",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-copilotkit-telemetry-id": PERSISTED_BROWSER_ID,
    },
    body: {
      event: "oss.inspector.banner_viewed",
      properties: {
        banner_id: "release-banner",
        distinct_id: PERSISTED_BROWSER_ID,
      },
      package: { name: "@copilotkit/web-inspector" },
      ts: FIXED_TELEMETRY_TIME_SECONDS,
    },
  },
  {
    url: "https://telemetry.copilotkit.ai/ingest",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-copilotkit-telemetry-id": PERSISTED_BROWSER_ID,
    },
    body: {
      event: "oss.inspector.threads_intelligence_signup_clicked",
      properties: {
        cta: "signup",
        cta_surface: "threads_locked",
        posthog_distinct_id: WEBSITE_ALIAS,
        package_name: "@copilotkit/web-inspector",
        package_version: webInspectorPackage.version,
        inspector_distinct_id: PERSISTED_BROWSER_ID,
        distinct_id: PERSISTED_BROWSER_ID,
      },
      package: {
        name: "@copilotkit/web-inspector",
        version: webInspectorPackage.version,
      },
      ts: FIXED_TELEMETRY_TIME_SECONDS,
    },
  },
  {
    url: "https://telemetry.copilotkit.ai/ingest",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-copilotkit-telemetry-id": PERSISTED_BROWSER_ID,
    },
    body: {
      event: "oss.inspector.talk_to_engineer_clicked",
      properties: {
        cta: "talk_to_engineer",
        cta_surface: "threads_header",
        posthog_distinct_id: WEBSITE_ALIAS,
        package_name: "@copilotkit/web-inspector",
        package_version: webInspectorPackage.version,
        inspector_distinct_id: PERSISTED_BROWSER_ID,
        distinct_id: PERSISTED_BROWSER_ID,
      },
      package: {
        name: "@copilotkit/web-inspector",
        version: webInspectorPackage.version,
      },
      ts: FIXED_TELEMETRY_TIME_SECONDS,
    },
  },
] as const;

interface InspectorTelemetryPayload {
  event: string;
  properties: {
    banner_id?: string;
    cta?: string;
    cta_surface?: string;
    distinct_id: string;
    inspector_distinct_id?: string;
    package_name?: string;
    package_version?: string;
    posthog_distinct_id?: string;
  };
  package: { name: string; version?: string };
  ts: number;
}

/** Normalize one captured fetch call into the complete observable request. */
function normalizeRequest(call: Parameters<typeof fetch>) {
  const [url, init] = call;
  if (typeof init?.body !== "string") {
    throw new Error("Expected Inspector telemetry to send a JSON body");
  }

  const body: InspectorTelemetryPayload = JSON.parse(init.body);
  return {
    url: String(url),
    method: init.method ?? "GET",
    headers: Object.fromEntries(
      [...new Headers(init.headers).entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    body,
  };
}

/** Capture the complete Inspector transport while asserting its opt-out contract. */
export async function captureInspectorTelemetryTransportContract() {
  window.localStorage.clear();
  _resetTelemetryPersistenceForTesting();
  window.localStorage.setItem(
    "cpk:inspector:telemetry:distinct_id",
    PERSISTED_BROWSER_ID,
  );
  const dateNow = vi
    .spyOn(Date, "now")
    .mockReturnValue(FIXED_TELEMETRY_TIME_MS);
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));

  try {
    trackBannerViewed({ banner_id: "release-banner" });
    trackThreadsIntelligenceSignupClicked({
      cta: "signup",
      cta_surface: "threads_locked",
      posthog_distinct_id: WEBSITE_ALIAS,
    });
    trackTalkToEngineerClicked({
      cta: "talk_to_engineer",
      cta_surface: "threads_header",
      posthog_distinct_id: WEBSITE_ALIAS,
    });
    await Promise.resolve();

    const requests = fetchMock.mock.calls.map(normalizeRequest);
    expect(
      window.localStorage.getItem("cpk:inspector:telemetry:distinct_id"),
    ).toBe(PERSISTED_BROWSER_ID);
    expect(getTelemetryDistinctIdForUrl()).toBe(PERSISTED_BROWSER_ID);

    fetchMock.mockClear();
    setTelemetryOptOut(true);
    trackBannerClicked({ banner_id: "release-banner", cta: "body" });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getTelemetryDistinctIdForUrl()).toBeNull();
    expect(
      window.localStorage.getItem("cpk:inspector:telemetry:distinct_id"),
    ).toBe(PERSISTED_BROWSER_ID);

    return requests;
  } finally {
    fetchMock.mockRestore();
    dateNow.mockRestore();
    window.localStorage.clear();
    _resetTelemetryPersistenceForTesting();
  }
}
