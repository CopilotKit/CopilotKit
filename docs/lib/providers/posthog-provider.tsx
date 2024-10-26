"use client";

import { PostHogProvider as PostHogProviderBase } from "posthog-js/react";
import posthog from "posthog-js";
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePathname, useSearchParams } from "next/navigation";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const isClerkEnabled = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { userId } = isClerkEnabled ? useAuth() : { userId: null };

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
    if (userId) {
      posthog?.identify(userId);
    }
  }, [userId]);

  useEffect(() => {
    if (POSTHOG_KEY && POSTHOG_HOST) {
      posthog?.capture("$pageview");
    }
  }, [pathname]);

  return <PostHogProviderBase client={posthog}>{children}</PostHogProviderBase>;
}
