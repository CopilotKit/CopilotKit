"use client";

import posthog from "posthog-js";
import { useCallback } from "react";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

export interface SignupLinkProps {
  /** Stable identifier for analytics, e.g. "docs_langgraph_quickstart_step1" */
  surface: string;
  children: React.ReactNode;
}

function buildHref(surface: string): string {
  // Read the signup URL at render time from the runtime config injected
  // by the root layout so a single built artifact can point at staging
  // vs prod by changing the Railway env var. The reader already returns
  // a fallback when NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL is unset.
  const signupUrl = getRuntimeConfig().intelligenceSignupUrl;
  const url = new URL(signupUrl);
  url.searchParams.set("utm_source", "docs");
  url.searchParams.set("utm_medium", "cta");
  url.searchParams.set("utm_campaign", "intelligence");
  url.searchParams.set("utm_content", surface);
  return url.toString();
}

export function SignupLink({ surface, children }: SignupLinkProps) {
  const handleClick = useCallback(() => {
    try {
      posthog.capture("try_for_free_clicked", { location: surface });
    } catch {
      // PostHog may be blocked by ad blockers — never let analytics block navigation.
    }
  }, [surface]);

  return (
    <a
      href={buildHref(surface)}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      // HubSpot's analytics tag rewrites the dashboard.operations.copilotkit.ai
      // outbound href client-side to attach `__hstc` / `__hssc` / `__hsfp`
      // cross-domain tracking params, which trips React's hydration diff.
      // Same fix on the nav-bar Intelligence CTA + OpsPlatformCTA variants.
      suppressHydrationWarning
      data-cta-surface={surface}
    >
      {children}
    </a>
  );
}
