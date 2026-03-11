"use client";

import { PostHogProvider as PostHogProviderBase } from "posthog-js/react";
import posthog from "posthog-js";
import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { normalizePathnameForAnalytics } from "@/lib/analytics-utils";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

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
    if (
      POSTHOG_KEY &&
      POSTHOG_HOST &&
      !posthog?.__loaded &&
      !isInitializedRef.current
    ) {
      isInitializedRef.current = true;

      // Read sessionId from URL at initialization time
      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const initSessionId = params?.get("session_id") ?? sessionId;

      // Suppress all PostHog-related console errors and warnings
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalLog = console.log;

      const suppressPostHogErrors = () => {
        console.error = (...args: any[]) => {
          const errorString = args.join(" ");
          const isPostHogError =
            errorString.includes("posthog") ||
            errorString.includes("PostHog") ||
            errorString.includes("request.ts") ||
            errorString.includes("posthog-core.ts") ||
            errorString.includes("ERR_BLOCKED_BY_CONTENT_BLOCKER") ||
            args.some(
              (arg) =>
                (typeof arg === "string" && arg.includes("posthog")) ||
                arg?.stack?.includes("posthog") ||
                arg?.message?.includes("posthog"),
            );

          if (isPostHogError) {
            // Suppress in production, log as warning in development
            if (process.env.NODE_ENV === "development") {
              originalWarn("[PostHog] Error suppressed:", ...args);
            }
            return;
          }
          originalError(...args);
        };

        console.warn = (...args: any[]) => {
          const warnString = args.join(" ");
          const isPostHogWarn =
            warnString.includes("posthog") ||
            warnString.includes("PostHog") ||
            warnString.includes("[PostHog.js]");

          if (isPostHogWarn) {
            // Suppress in production, log in development
            if (process.env.NODE_ENV === "development") {
              originalLog("[PostHog] Warning suppressed:", ...args);
            }
            return;
          }
          originalWarn(...args);
        };
      };

      try {
        // Suppress PostHog errors permanently (they're just noise from ad blockers)
        suppressPostHogErrors();

        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          person_profiles: "identified_only",
          bootstrap: initSessionId
            ? {
                sessionID: initSessionId,
              }
            : undefined,
          // Disable automatic pageview capture (we do it manually)
          capture_pageview: false,
          // Reduce network requests by batching
          request_batching: true,
          // Don't enable debug mode - it causes too much logging
        });
      } catch (error) {
        // Silently fail if PostHog init fails (e.g., network issues, blocked by ad blockers)
        if (process.env.NODE_ENV === "development") {
          originalWarn("PostHog initialization failed:", error);
        }
      }
    }
  }, []); // Only run once on mount

  // Capture pageview only after PostHog is initialized
  useEffect(() => {
    if (POSTHOG_KEY && POSTHOG_HOST && posthog?.__loaded) {
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
