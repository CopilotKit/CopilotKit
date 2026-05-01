"use client";

import { PostHogProvider as PostHogProviderBase } from "posthog-js/react";
import posthog from "posthog-js";
import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { normalizePathnameForAnalytics } from "@/lib/analytics-utils";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// Reverse-proxied via /ingest/* rewrites in next.config.mjs so requests
// flow through docs.copilotkit.ai instead of *.i.posthog.com — bypasses
// ad blockers / tracking-protection that target the PostHog hostname.
const POSTHOG_HOST = "/ingest";
const POSTHOG_UI_HOST = "https://eu.posthog.com";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const isInitializedRef = useRef(false);

  // Read session_id from URL only on client side to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setSessionId(params.get("session_id"));
    }
  }, []);

  // Initialize PostHog once (only on mount)
  useEffect(() => {
    if (POSTHOG_KEY && !posthog?.__loaded && !isInitializedRef.current) {
      isInitializedRef.current = true;

      // Read sessionId from URL at initialization time
      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const initSessionId = params?.get("session_id") ?? sessionId;

      try {
        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          ui_host: POSTHOG_UI_HOST,
          person_profiles: "identified_only",
          bootstrap: initSessionId
            ? {
                sessionID: initSessionId,
              }
            : undefined,
          capture_pageview: false,
          request_batching: true,
        });
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.warn("PostHog initialization failed:", error);
        }
      }
    }
  }, []); // Only run once on mount

  // Capture pageview only after PostHog is initialized
  useEffect(() => {
    if (POSTHOG_KEY && posthog?.__loaded) {
      try {
        const normalizedPathname = normalizePathnameForAnalytics(pathname);
        posthog.capture("$pageview", {
          $current_url: `https://docs.copilotkit.ai${normalizedPathname}`,
        });
      } catch (error) {
        // Silently fail if PostHog capture fails (e.g., network issues)
        if (process.env.NODE_ENV === "development") {
          console.warn("PostHog capture failed:", error);
        }
      }
    }
  }, [pathname]);

  return <PostHogProviderBase client={posthog}>{children}</PostHogProviderBase>;
}
