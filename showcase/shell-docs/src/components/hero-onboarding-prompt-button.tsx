"use client";
import {
  ONBOARDING_ARGUMENT_TEXT,
  ONBOARDING_ARGUMENT_VERSION,
} from "@/lib/onboarding-argument-templates";

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
          onAction: (action) =>
            posthog?.capture(
              "docs.intelligence_onboarding_prompt_action_clicked",
              {
                action,
                from_path: pathname,
                onboarding_run_id: runId,
                surface,
                agent_framework: graphFramework,
                argument_version: ONBOARDING_ARGUMENT_VERSION,
                argument_text: ONBOARDING_ARGUMENT_TEXT,
              },
            ),
          onCopied: (action) =>
            posthog?.capture("docs.intelligence_onboarding_prompt_copied", {
              action,
              from_path: pathname,
              onboarding_run_id: runId,
              surface,
              agent_framework: graphFramework,
              // Which revision of the argument prose was appended. The hosted
              // document versions its own text; this is the other half of what
              // the developer copied (PE-255).
              argument_version: ONBOARDING_ARGUMENT_VERSION,
              argument_text: ONBOARDING_ARGUMENT_TEXT,
            }),
        };
      }}
    />
  );
}
