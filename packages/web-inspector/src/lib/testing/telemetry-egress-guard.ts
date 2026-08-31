// Test-only helper (imported by vitest.setup.ts — never by the bundle entry).
//
// This suite runs in jsdom, where a real `fetch` exists. Inspector telemetry is
// browser-side and fire-and-forget, so any test that drives a banner / threads /
// open code path without stubbing fetch POSTs a real `oss.inspector.*` event to
// the live sink — from a developer's machine and from every CI run — polluting
// the dataset with traffic indistinguishable from user activity. The
// announcement-dismissal tests did exactly this before this guard existed.
//
// No environment variable can prevent it: the inspector's opt-out is the
// runtime's `/info` response, and these tests never boot a runtime.
//
// The guard swallows requests to the sink and delegates everything else, so
// tests that stub or spy on fetch themselves are unaffected.

export const TELEMETRY_SINK_ORIGIN = "https://telemetry.copilotkit.ai";

export function createTelemetryEgressGuard(
  realFetch: typeof fetch,
): typeof fetch {
  const guardedFetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> => {
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

  // Some runtimes add static helpers to `fetch` (for example Bun's
  // `preconnect`). Preserve them so wrapping the function keeps its full
  // platform contract as well as its call signature.
  return Object.assign(guardedFetch, realFetch);
}
