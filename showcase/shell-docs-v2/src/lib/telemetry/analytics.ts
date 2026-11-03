// Client-side analytics, ported from shell-docs (posthog-provider.tsx,
// track-command-copy.ts, analytics-utils.ts). Event names and property shapes
// match shell-docs exactly so the existing PostHog dashboards keep working.
//
// Safe to import anywhere: every function no-ops on the server.

import posthog from "posthog-js";
import { FRAMEWORKS } from "@/proto/data";

export type AnalyticsProperties = Record<string, unknown>;

// PostHog is initialized once the browser has its key (fetched after
// hydration), so events fired before that wait here and go out in order, with
// their original timestamps. Dropped if telemetry turns out to be disabled.
const MAX_PENDING = 100;
let pending: { name: string; props?: AnalyticsProperties; at: Date }[] | null =
  [];

/**
 * Send a PostHog event. Never throws: analytics must not break the page.
 */
export function trackEvent(name: string, props?: AnalyticsProperties): void {
  if (typeof window === "undefined") return;
  try {
    if (posthog.__loaded) {
      posthog.capture(name, props);
    } else if (pending && pending.length < MAX_PENDING) {
      pending.push({ name, props, at: new Date() });
    }
  } catch {
    // Blocked or failed analytics must never interrupt the reader.
  }
}

/**
 * Initialize PostHog with shell-docs' settings, then flush queued events. An
 * empty key means analytics is off in this environment: the queue is dropped.
 */
export function initPostHog(key: string): void {
  if (typeof window === "undefined" || posthog.__loaded) return;
  if (key) {
    try {
      // A session handed over in the URL (e.g. from copilotkit.ai) continues.
      const sessionId = new URLSearchParams(window.location.search).get(
        "session_id",
      );
      posthog.init(key, {
        // Reverse-proxied through the docs host by the /ingest rewrites in
        // next.config.mjs, so blockers targeting *.i.posthog.com don't drop it.
        api_host: "/ingest",
        ui_host: "https://eu.posthog.com",
        person_profiles: "identified_only",
        bootstrap: sessionId ? { sessionID: sessionId } : undefined,
        // Pageviews are captured by <Telemetry />, per client navigation.
        capture_pageview: false,
        capture_dead_clicks: false,
        request_batching: true,
      });
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("PostHog initialization failed:", error);
      }
    }
  }
  const queued = pending ?? [];
  pending = null;
  if (!posthog.__loaded) return;
  for (const event of queued) {
    try {
      posthog.capture(event.name, event.props, { timestamp: event.at });
    } catch {
      // Ignore; see trackEvent.
    }
  }
}

/** PostHog's `$pageview`, with the URL normalized as shell-docs did. */
export function trackPageview(pathname: string): void {
  if (typeof window === "undefined" || !posthog.__loaded) return;
  try {
    const path =
      pathname === "/" || !pathname ? "/" : pathname.replace(/\/$/, "");
    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${path}`,
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("PostHog capture failed:", error);
    }
  }
}

/**
 * The current PostHog session id, for handing the session to another
 * CopilotKit property in a link's `session_id` param. Undefined until PostHog
 * is up (or when analytics is off).
 */
export function getPostHogSessionId(): string | undefined {
  if (typeof window === "undefined" || !posthog.__loaded) return undefined;
  try {
    return posthog.get_session_id() || undefined;
  } catch {
    return undefined;
  }
}

const KNOWN_INSTALL_TYPES = [
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "uv",
  "poetry",
  "cargo",
  "go",
  "docker",
  "curl",
  "brew",
  "helm",
  "kubectl",
  "make",
  "bash",
  "sh",
] as const;

export type InstallType = (typeof KNOWN_INSTALL_TYPES)[number] | "code";

function inferInstallType(command: string): InstallType {
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (!firstToken) return "code";
  return (KNOWN_INSTALL_TYPES as readonly string[]).includes(firstToken)
    ? (firstToken as InstallType)
    : "code";
}

export type TrackCommandCopyArgs = {
  command: string;
  location?: string;
};

/** `cli_command_copied`, fired for every clipboard copy on the site. */
export function trackCommandCopy({ command, location }: TrackCommandCopyArgs) {
  const trimmed = command.trim();
  if (!trimmed) return;
  trackEvent("cli_command_copied", {
    install_type: inferInstallType(trimmed),
    ...(location ? { location } : {}),
  });
}

const FRAMEWORK_IDS = new Set(FRAMEWORKS.map((f) => f.id));

/**
 * Canonicalize a URL for analytics: `/integrations/<framework>/...` becomes
 * `/<framework>/...` for known frameworks, and trailing slashes go (except on
 * the root).
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;

  const segments = url.split("/").filter(Boolean);
  if (
    segments[0] === "integrations" &&
    segments.length > 1 &&
    FRAMEWORK_IDS.has(segments[1])
  ) {
    const rest = segments.slice(2).join("/");
    return `/${segments[1]}${rest ? `/${rest}` : ""}`;
  }

  return url === "/" ? "/" : url.replace(/\/$/, "");
}

/** Alias of `normalizeUrl`, for analytics call sites. */
export function normalizePathnameForAnalytics(pathname: string): string {
  return normalizeUrl(pathname);
}
