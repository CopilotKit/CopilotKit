// Server-only telemetry config, ported from shell-docs' runtime-config.ts
// (the analytics-key half of it). Env vars are read at REQUEST time with a
// computed key, so Next can't inline them at build: one built artifact serves
// staging and prod, and a Docker build without the vars doesn't silently ship
// with analytics off. Same env var names as shell-docs.
//
// Don't import this from client code. The browser gets these values from
// `/api/telemetry/config` (see `src/components/telemetry`).

/** Analytics keys; an empty string disables that channel. */
export interface TelemetryConfig {
  posthogKey: string;
  scarfPixelId: string;
  googleAnalyticsTrackingId: string;
  reb2bKey: string;
  reoKey: string;
}

const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

export function getTelemetryConfig(): TelemetryConfig {
  return {
    posthogKey: readEnvPair("NEXT_PUBLIC_POSTHOG_KEY") ?? "",
    scarfPixelId: readEnvPair("NEXT_PUBLIC_SCARF_PIXEL_ID") ?? "",
    googleAnalyticsTrackingId:
      readEnvPair("NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID") ?? "",
    reb2bKey: readEnvPair("NEXT_PUBLIC_REB2B_KEY") ?? "",
    reoKey: readEnvPair("NEXT_PUBLIC_REO_KEY") ?? "",
  };
}

/** PostHog's capture host for server-side events (the proxy). EU cloud by default. */
export function getPosthogHost(): string {
  return (
    readEnvPair("NEXT_PUBLIC_POSTHOG_HOST") ?? DEFAULT_POSTHOG_HOST
  ).replace(/\/+$/, "");
}

// Deploy configs in the wild set either `X` or `NEXT_PUBLIC_X`; accept both,
// primary first. An empty primary falls through to the alternate.
function readEnvPair(envKey: string): string | undefined {
  const alt = envKey.startsWith("NEXT_PUBLIC_")
    ? envKey.slice("NEXT_PUBLIC_".length)
    : `NEXT_PUBLIC_${envKey}`;
  for (const key of [envKey, alt]) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}
