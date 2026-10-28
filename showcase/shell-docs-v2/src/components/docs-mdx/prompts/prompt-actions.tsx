"use client";

import { trackEvent } from "@/lib/telemetry/analytics";
import type { DocsScope } from "../scope";
import {
  INTELLIGENCE_ONBOARDING_EVENTS,
  ROOT_FRAMEWORK,
  createFeatureSetupPrompt,
  createOnboardingRunId,
  onboardingFrameworkSlug,
  onboardingFrontendSlug,
  pageSourceSentence,
  type FeatureOnboardingIntent,
} from "./onboarding";
import { usePageStack } from "./page-stack";
import { PromptGuidance, PromptPill } from "./prompt-pill";

export interface PromptRequest {
  text: string;
  analyticsProperties?: Record<string, unknown>;
}

/**
 * The prompt pill a setup section shows, with shell-docs' analytics
 * (`DocsPromptActions`): every action and copy names the page's framework
 * and frontend as the onboarding graph spells them, the page, and the
 * surface. The page's own Markdown and Open actions live in its header.
 */
export function DocsPromptActions({
  scope,
  surface,
  createPrompt,
  copiedEvent = INTELLIGENCE_ONBOARDING_EVENTS.promptCopied,
  includePageSource = false,
}: {
  scope: DocsScope;
  surface: string;
  createPrompt: () => PromptRequest;
  /** Keeps each surface's existing success event. */
  copiedEvent?: string;
  /** Append the page this prompt was copied from. */
  includePageSource?: boolean;
}) {
  const { pathname, framework, frontend } = usePageStack(scope);
  return (
    <div className="not-prose flex min-w-0 flex-col gap-3">
      <PromptPill
        surface={surface}
        createPrompt={() => {
          const payload = createPrompt();
          const properties = {
            agent_framework: onboardingFrameworkSlug(
              framework ?? ROOT_FRAMEWORK,
            ),
            frontend: onboardingFrontendSlug(frontend),
            ...payload.analyticsProperties,
            from_path: pathname,
            surface,
          };
          return {
            text: includePageSource
              ? payload.text + pageSourceSentence(pathname)
              : payload.text,
            onAction: (action) =>
              trackEvent(INTELLIGENCE_ONBOARDING_EVENTS.actionClicked, {
                ...properties,
                action,
              }),
            onCopied: (action) =>
              trackEvent(copiedEvent, { ...properties, action }),
          };
        }}
      />
      <PromptGuidance />
    </div>
  );
}

export interface CodingAgentSetupPromptProps {
  scope: DocsScope;
  /** What the prompt does, for assistive tech. */
  summary: string;
  /** The prompt copied, or a builder for one (client callers only). */
  prompt: string | (() => PromptRequest);
  /** Stable analytics identifier for the page that owns this prompt. */
  copySurface: string;
  feature: string;
  /** Only CLI-backed features mint an id that joins to a CLI run. */
  onboardingIntent?: FeatureOnboardingIntent;
  copiedEvent?: string;
  includePageSource?: boolean;
}

/** A feature guide's coding-agent prompt (shell-docs' `CodingAgentSetupPrompt`). */
export function CodingAgentSetupPrompt({
  scope,
  summary,
  prompt,
  copySurface,
  feature,
  onboardingIntent,
  copiedEvent,
  includePageSource,
}: CodingAgentSetupPromptProps) {
  return (
    <section
      aria-label={summary}
      className="not-prose my-6"
      data-docs-copy-surface={copySurface}
    >
      <DocsPromptActions
        scope={scope}
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
