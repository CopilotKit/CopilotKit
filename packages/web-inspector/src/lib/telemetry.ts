// Inspector-side anonymous telemetry. Three V1 events fire from index.ts —
// `oss.inspector.banner_viewed`, `oss.inspector.banner_clicked`, and
// `oss.inspector.threads_tab_clicked`. POSTs directly from the browser
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
} from "./persistence";

// V1 funnel events. Namespaced `oss.inspector.*` so the lambda's
// event-type allowlist (oss-path-to-production) can gate them
// server-side. Adding a new event here requires a corresponding
// allowlist entry on the lambda or events will be rejected.
export const TELEMETRY_EVENTS = {
  bannerViewed: "oss.inspector.banner_viewed",
  bannerClicked: "oss.inspector.banner_clicked",
  threadsTabClicked: "oss.inspector.threads_tab_clicked",
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

// 3-second cap so a slow gateway can't hang the host app. Matches the
// runtime's existing scarf-client convention.
const FETCH_TIMEOUT_MS = 3000;

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
  const distinctId = getOrCreateTelemetryDistinctId();
  const body = JSON.stringify({
    event,
    properties: {
      ...properties,
      distinct_id: distinctId,
    },
    package: { name: PACKAGE_NAME },
    ts: Math.floor(Date.now() / 1000),
  });

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

export function trackThreadsTabClicked(): void {
  track(TELEMETRY_EVENTS.threadsTabClicked);
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
