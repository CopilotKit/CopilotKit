import { PostHogProvider as PostHogProviderBase } from "posthog-js/react";
import posthog from "posthog-js";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST;

if (typeof window !== "undefined") {
  // Get search param
  const searchParams = new URLSearchParams(window.location.search);
  const sessionId = searchParams.get("session_id");
  
  if (POSTHOG_KEY && POSTHOG_HOST) {

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
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { userId } = useAuth();
  const searchParams = useSearchParams();

  const sessionId = searchParams.get("session_id");

  posthog?.set_config({
    bootstrap: {
      sessionID: sessionId ?? undefined,
    },
  });

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

  useEffect(() => {
    if (userId) {
      posthog?.identify(userId);
    }
  }, [userId]);

  return <PostHogProviderBase client={posthog}>{children}</PostHogProviderBase>;
}