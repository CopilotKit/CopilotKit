// Check that PostHog is client-side (used to handle Next.js SSR)
import { useRouter } from "next/router";
import posthog from "posthog-js";
import { useEffect } from "react";

const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST;

if (typeof window !== "undefined") {
  if (POSTHOG_KEY && POSTHOG_HOST) {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      // Enable debug mode in development
      loaded: (posthog) => {
        if (process.env.NODE_ENV === "development") posthog.debug();
      },
    });
  }
}

export function usePostHog() {
  const router = useRouter();

  useEffect(() => {
    if (!POSTHOG_KEY || !POSTHOG_HOST) return;

    const handleRouteChange = () => {
      posthog?.capture("$pageview");
    };

    router.events.on("routeChangeComplete", handleRouteChange);

    return () => {
      router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, []);

  return { posthog };
}
