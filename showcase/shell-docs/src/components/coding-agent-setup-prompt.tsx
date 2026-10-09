"use client";

import React from "react";
import {
  createFeatureSetupPrompt,
  createOnboardingRunId,
} from "@/lib/intelligence-onboarding-prompt";
import type { FeatureOnboardingIntent } from "@/lib/intelligence-onboarding-prompt";
import { DocsPromptActions } from "./docs-prompt-actions";

export interface CodingAgentSetupPromptProps {
  /** Short task-specific description of the prompt. */
  summary: string;
  /** Full prompt copied to the clipboard and revealed on demand. */
  prompt:
    | string
    | React.ComponentProps<typeof DocsPromptActions>["createPrompt"];
  /** Stable analytics identifier for the page that owns this prompt. */
  copySurface: string;
  feature: string;
  /** Only CLI-backed features mint an ID that can join to a CLI run. */
  onboardingIntent?: FeatureOnboardingIntent;
  copiedEvent?: string;
  includePageSource?: boolean;
}

/** Setup prompts share copy, preview, app launch, and clipboard recovery. */
export function CodingAgentSetupPrompt({
  summary,
  prompt,
  copySurface,
  feature,
  onboardingIntent,
  copiedEvent,
  includePageSource,
}: CodingAgentSetupPromptProps): React.JSX.Element {
  return (
    <section
      aria-label={summary}
      className="not-prose my-6"
      data-docs-copy-surface={copySurface}
    >
      <DocsPromptActions
        surface={copySurface}
        copiedEvent={copiedEvent}
        includePageSource={includePageSource}
        createPrompt={() => {
          if (typeof prompt === "function") return prompt();
          const runId = onboardingIntent ? createOnboardingRunId() : undefined;
          return {
            text: onboardingIntent
              ? createFeatureSetupPrompt(onboardingIntent, runId)
              : prompt,
            analyticsProperties: {
              feature,
              onboarding_intent: onboardingIntent,
              onboarding_run_id: runId,
            },
          };
        }}
      />
    </section>
  );
}
