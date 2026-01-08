"use client";

import { PostHogProvider as PostHogProviderBase } from "posthog-js/react";
import posthog from "posthog-js";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { normalizePathnameForAnalytics } from "@/lib/analytics-utils";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    if (POSTHOG_KEY && POSTHOG_HOST && !posthog?.__loaded) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        person_profiles: "identified_only",
        bootstrap: {
          sessionID: sessionId ?? undefined,
        },
        // Enable debug mode in development
        loaded: (posthog) => {
          if (process.env.NODE_ENV === "development") posthog.debug();
        },
      });
    }
  }, []);

  useEffect(() => {
    if (POSTHOG_KEY && POSTHOG_HOST) {
      const normalizedPathname = normalizePathnameForAnalytics(pathname);
      posthog?.capture("$pageview", {
        $current_url: normalizedPathname,
      });
    }
  }, [pathname]);

  return <PostHogProviderBase client={posthog}>{children}</PostHogProviderBase>;
}
