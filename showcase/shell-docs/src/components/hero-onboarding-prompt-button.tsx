"use client";

// <HeroOnboardingPromptButton> — the compact hero twin of
// <IntelligenceOnboardingPrompt>. Same prompt, same run id, same PostHog event
// and property names, so the hero placement and the in-page section land in one
// comparable funnel instead of two that cannot be joined.

import React from "react";
import { PromptPill } from "./prompt-pill";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import {
  frameworkPromptSuffix,
  onboardingFrameworkSlug,
} from "@/lib/intelligence-onboarding-framework";
import {
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";

export interface HeroOnboardingPromptButtonProps {
  surface: string;
  /**
   * The framework landing page this button sits on: `slug` is the docs
   * registry slug, `name` the display name. Omitted on the docs home, where
   * there is no framework to name and the prompt stays canonical.
   */
  framework?: { slug: string; name: string };
}

export function HeroOnboardingPromptButton({
  surface,
  framework,
}: HeroOnboardingPromptButtonProps): React.JSX.Element {
  const pathname = usePathname();
  const posthog = usePostHog();
  return (
    <PromptPill
      surface={surface}
      createPrompt={() => {
        const runId = createOnboardingRunId();
        const graphFramework = framework
          ? onboardingFrameworkSlug(framework.slug)
          : undefined;
        return {
          text:
            createIntelligenceOnboardingPrompt(runId) +
            (framework
              ? frameworkPromptSuffix(framework.slug, framework.name)
              : ""),
          onCopied: () =>
            posthog?.capture(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, {
              from_path: pathname,
              onboarding_run_id: runId,
              surface,
              ...(graphFramework ? { agent_framework: graphFramework } : {}),
            }),
        };
      }}
    />
  );
}
