// Test-only helper (imported by vitest.setup.ts — never by the bundle entry).
//
// The inspector's telemetry is browser-side: it keys off `telemetryDisabled`
// from the runtime's /info handshake, so COPILOTKIT_TELEMETRY_DISABLED in a CI
// job cannot reach it (OSS-565). Any test that drives a banner / threads /
// open code path without stubbing fetch would therefore POST a real
// `oss.inspector.*` event to the live sink from CI — pollution
// indistinguishable from user activity.
//
// The guard swallows requests to the sink and delegates everything else, so
// tests that stub or spy on fetch themselves are unaffected.

export const TELEMETRY_SINK_ORIGIN = "https://telemetry.copilotkit.ai";

export function createTelemetryEgressGuard(
  realFetch: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url?.startsWith(TELEMETRY_SINK_ORIGIN)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return realFetch(input, init);
  };
}
