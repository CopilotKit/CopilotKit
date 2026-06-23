// Inspector-side anonymous telemetry. V1 events fire from index.ts for
// banner and thread-inspection interactions. POSTs directly from the browser
// to the CopilotKit telemetry sink at `telemetry.copilotkit.ai/ingest`,
// where a Lambda fan-out forwards events to PostHog / Reo / Scarf.
//
// The endpoint URL is intentionally clearly named so it's obvious in
// DevTools / Network tab — transparency for opt-in users.
//
// Privacy invariants enforced here:
//   - We never send message content, agent state, prompts, completions,
//     or banner markdown. Properties are scoped to event metadata only
//     (banner_id/timestamp, cta location). Reviewers should grep call
//     sites for any unintended payload.
//   - The opt-out short-circuits before any network call. There is no
//     buffer, no retry queue.
//   - All errors are swallowed; telemetry must never break the host app.

import {
  getOrCreateTelemetryDistinctId,
  hasTelemetryDisclosureBeenShown,
  isTelemetryOptedOut,
  markTelemetryDisclosureShown,
} from "./persistence.js";

// V1 funnel events. Namespaced `oss.inspector.*` so the lambda's
// event-type allowlist (oss-path-to-production) can gate them
// server-side. Adding a new event here requires a corresponding
// allowlist entry on the lambda or events will be rejected.
export const TELEMETRY_EVENTS = {
  bannerViewed: "oss.inspector.banner_viewed",
  bannerClicked: "oss.inspector.banner_clicked",
  threadsTabClicked: "oss.inspector.threads_tab_clicked",
  threadsLockedViewed: "oss.inspector.threads_locked_viewed",
  threadsIntelligenceSignupClicked:
    "oss.inspector.threads_intelligence_signup_clicked",
  threadsTalkToEngineerClicked:
    "oss.inspector.threads_talk_to_engineer_clicked",
  talkToEngineerClicked: "oss.inspector.talk_to_engineer_clicked",
  threadsEmptyEnabledViewed: "oss.inspector.threads_empty_enabled_viewed",
  threadsEnabledViewed: "oss.inspector.threads_enabled_viewed",
} as const;

export type TelemetryEvent =
  (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

// Per the OSS-96 ticket — the URL is intentionally clearly named for
// transparency in the network tab.
export const TELEMETRY_INGEST_URL = "https://telemetry.copilotkit.ai/ingest";

// Surfaced in console disclosure and the in-product opt-out panel.
// Keep in sync with the canonical telemetry docs page on main
// (`docs/content/docs/(root)/(other)/telemetry/index.mdx`).
// Mirror constant: packages/runtime/src/lib/telemetry-disclosure.ts
export const TELEMETRY_DOCS_URL = "https://docs.copilotkit.ai/telemetry";

const PACKAGE_NAME = "@copilotkit/web-inspector";
const PACKAGE_VERSION = "1.61.1";

// 3-second cap so a slow gateway can't hang the host app. Matches the
// runtime's existing scarf-client convention.
const FETCH_TIMEOUT_MS = 3000;

function isThreadsTelemetryEvent(event: TelemetryEvent): boolean {
  return (
    event === TELEMETRY_EVENTS.threadsTabClicked ||
    event === TELEMETRY_EVENTS.threadsLockedViewed ||
    event === TELEMETRY_EVENTS.threadsIntelligenceSignupClicked ||
    event === TELEMETRY_EVENTS.threadsTalkToEngineerClicked ||
    event === TELEMETRY_EVENTS.talkToEngineerClicked ||
    event === TELEMETRY_EVENTS.threadsEmptyEnabledViewed ||
    event === TELEMETRY_EVENTS.threadsEnabledViewed
  );
}

export type RuntimeUrlType =
  | "missing"
  | "relative"
  | "localhost"
  | "same_origin"
  | "remote"
  | "invalid";

export function getRuntimeUrlType(
  runtimeUrl: string | undefined,
): RuntimeUrlType {
  if (!runtimeUrl) return "missing";
  if (runtimeUrl.startsWith("/") && !runtimeUrl.startsWith("//")) {
    return "relative";
  }

  try {
    const baseHref =
      typeof window !== "undefined"
        ? window.location.href
        : "https://copilotkit.ai";
    const url = new URL(runtimeUrl, baseHref);
    const baseUrl = new URL(baseHref);
    const hostname = url.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    ) {
      return "localhost";
    }

    return url.origin === baseUrl.origin ? "same_origin" : "remote";
  } catch {
    return "invalid";
  }
}

/**
 * Fire-and-forget telemetry send. Returns synchronously; the network
 * call is dispatched in the background and any failure is swallowed.
 *
 * Short-circuits when the user has opted out. Does NOT itself trigger
 * the first-run disclosure — call `maybeShowDisclosure()` from the
 * inspector's mount lifecycle instead.
 */
export function track(
  event: TelemetryEvent,
  properties: Record<string, unknown> = {},
): void {
  if (isTelemetryOptedOut()) return;

  const distinctId = getOrCreateTelemetryDistinctId();
  const threadsProperties = isThreadsTelemetryEvent(event)
    ? {
        package_name: PACKAGE_NAME,
        package_version: PACKAGE_VERSION,
        inspector_distinct_id: distinctId,
      }
    : {};
  let body: string;
  try {
    body = JSON.stringify({
      event,
      properties: {
        ...properties,
        ...threadsProperties,
        distinct_id: distinctId,
      },
      package: {
        name: PACKAGE_NAME,
        ...(isThreadsTelemetryEvent(event) ? { version: PACKAGE_VERSION } : {}),
      },
      ts: Math.floor(Date.now() / 1000),
    });
  } catch {
    return;
  }

  void postBestEffort(TELEMETRY_INGEST_URL, body, distinctId);
}

// --- Typed per-event helpers ---
// These enforce the known property shape for each V1 event at the call
// site, so callers can't accidentally include PII under a wrong key.

export function trackBannerViewed(props: {
  banner_id: string;
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.bannerViewed, props);
}

export function trackBannerClicked(props: {
  banner_id: string;
  cta: "body" | "dismiss";
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.bannerClicked, props);
}

export type InspectorThreadTelemetryProps = {
  package_name?: typeof PACKAGE_NAME;
  package_version?: typeof PACKAGE_VERSION;
  inspector_distinct_id?: string;
  posthog_distinct_id?: string;
  intelligence_status?:
    | "intelligence_not_enabled"
    | "intelligence_enabled"
    | "unknown";
  thread_service_status?: "unavailable" | "available" | "unknown" | "error";
  license_status?:
    | "valid"
    | "none"
    | "expired"
    | "expiring"
    | "invalid"
    | "unknown";
  runtime_mode?: "sse" | "intelligence";
  runtime_url_type?: RuntimeUrlType;
  cta_surface?:
    | "threads_locked"
    | "threads_header"
    | "threads_empty"
    | "threads_populated";
  cta?: "signup" | "talk_to_engineer";
  telemetry_disabled?: boolean;
  thread_count?: number;
};

export function trackThreadsTabClicked(
  props: InspectorThreadTelemetryProps = {},
): void {
  track(TELEMETRY_EVENTS.threadsTabClicked, props);
}

export function trackThreadsLockedViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsLockedViewed, props);
}

export function trackThreadsIntelligenceSignupClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsIntelligenceSignupClicked, props);
}

export function trackThreadsTalkToEngineerClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsTalkToEngineerClicked, props);
}

export function trackTalkToEngineerClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.talkToEngineerClicked, props);
}

export function trackThreadsEmptyEnabledViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsEmptyEnabledViewed, props);
}

export function trackThreadsEnabledViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsEnabledViewed, props);
}

/**
 * Returns the inspector's anonymous distinct-ID for cross-domain
 * propagation onto outbound banner-CTA links, or `null` when the user
 * is opted out.
 *
 * The website / Ops API reads this query param on signup-flow landing
 * pages and calls `posthog.alias(...)` to merge the inspector's anon
 * ID with the website's anon ID, enabling the
 * `banner_viewed → banner_clicked → signup_attributed` funnel.
 * `identify()` itself is out of scope here (it happens on signup, in
 * the website / Ops API).
 *
 * Opt-out short-circuits this too: if the user has opted out, we do
 * NOT leak an anon ID across domains.
 */
export function getTelemetryDistinctIdForUrl(): string | null {
  if (isTelemetryOptedOut()) return null;
  return getOrCreateTelemetryDistinctId();
}

/**
 * Seeds the anonymous distinct-ID into localStorage on inspector mount
 * so it is ready for cross-domain propagation onto banner-CTA links
 * even before the first event fires. No-op when the user has opted out.
 */
export function ensureTelemetryDistinctId(): void {
  if (isTelemetryOptedOut()) return;
  getOrCreateTelemetryDistinctId();
}

/**
 * Fires the one-time console disclosure on inspector mount, when the
 * user is not opted out and hasn't seen it before. Idempotent across
 * calls within a single session because `markTelemetryDisclosureShown`
 * persists to localStorage.
 *
 * If the user is opted out, we deliberately do nothing and do NOT mark
 * the flag — so a future opt-in flips back to "first run" behavior.
 */
export function maybeShowDisclosure(): void {
  if (isTelemetryOptedOut()) return;
  if (hasTelemetryDisclosureBeenShown()) return;
  // eslint-disable-next-line no-console
  console.info(
    `[CopilotKit Inspector] anonymous interaction telemetry enabled — see ${TELEMETRY_DOCS_URL} to opt out.`,
  );
  markTelemetryDisclosureShown();
}

export { isTelemetryOptedOut };

async function postBestEffort(
  url: string,
  body: string,
  distinctId: string,
): Promise<void> {
  if (typeof fetch === "undefined") return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CopilotKit-Telemetry-Id": distinctId,
      },
      body,
      signal: controller.signal,
      // No credentials / no Authorization header — anonymous endpoint.
    });
  } catch {
    // Silent failure — telemetry must not break the application.
  } finally {
    clearTimeout(timeoutId);
  }
}
