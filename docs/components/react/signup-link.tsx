"use client";

import posthog from "posthog-js";
import { useCallback } from "react";

const DEFAULT_SIGNUP_URL = "https://dashboard.operations.copilotkit.ai/";

const SIGNUP_URL =
  process.env.NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL || DEFAULT_SIGNUP_URL;

export interface SignupLinkProps {
  /** Stable identifier for analytics, e.g. "docs_langgraph_quickstart_step1" */
  surface: string;
  children: React.ReactNode;
}

function buildHref(surface: string): string {
  const url = new URL(SIGNUP_URL);
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
      data-cta-surface={surface}
    >
      {children}
    </a>
  );
}
