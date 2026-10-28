"use client";

import { trackEvent } from "@/lib/telemetry/analytics";
import type { DocsScope } from "../scope";
import {
  FRONTEND_NAMES,
  INTELLIGENCE_ONBOARDING_EVENTS,
  ONBOARDING_ARGUMENT_TEXT,
  ONBOARDING_ARGUMENT_VERSION,
  createChannelsOnboardingPrompt,
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
  isChannelOnboardingId,
  onboardingFrameworkSlug,
  onboardingFrontendSlug,
  pageSourceSentence,
  pageTopicSentence,
} from "./onboarding";
import { usePageStack } from "./page-stack";
import { PromptGuidance, PromptPill } from "./prompt-pill";

/** shell-docs' surface name for the page's onboarding prompt. */
const ONBOARDING_COPY_SURFACE = "docs_page_tools_onboarding_prompt";

/**
 * The page's coding-agent prompt, in content (shell-docs' `<PageAgentPrompt>`,
 * its `OnboardingPromptCopyButton`): the canonical onboarding prompt with a
 * fresh run id per copy, what the page covers, and the page it came from.
 * The framework and frontend describe the page, never the reader's project.
 * Slack and Teams pages copy the plain Channels prompt.
 */
export function PageAgentPrompt({
  scope,
  framework,
}: {
  scope: DocsScope;
  /** The page's framework and its prompt name; absent with no registry record. */
  framework?: { slug: string; name: string };
}) {
  const { pathname, frontend: frontendId } = usePageStack(scope);
  const frontend = {
    id: frontendId,
    name: FRONTEND_NAMES[frontendId] ?? frontendId,
  };

  return (
    <div className="not-prose my-6 flex min-w-0 flex-col gap-3">
      <PromptPill
        surface={ONBOARDING_COPY_SURFACE}
        createPrompt={() => {
          const runId = createOnboardingRunId();
          const channel = isChannelOnboardingId(frontend.id)
            ? frontend.id
            : undefined;
          const properties = {
            from_path: pathname,
            onboarding_run_id: runId,
            surface: ONBOARDING_COPY_SURFACE,
            agent_framework: framework
              ? onboardingFrameworkSlug(framework.slug)
              : undefined,
            frontend: onboardingFrontendSlug(frontend.id),
            channel,
            argument_version: ONBOARDING_ARGUMENT_VERSION,
            argument_text: ONBOARDING_ARGUMENT_TEXT,
          };
          return {
            text:
              (channel
                ? createChannelsOnboardingPrompt(runId)
                : createIntelligenceOnboardingPrompt(runId) +
                  pageTopicSentence(framework, frontend)) +
              pageSourceSentence(pathname),
            onAction: (action) =>
              trackEvent(INTELLIGENCE_ONBOARDING_EVENTS.actionClicked, {
                action,
                ...properties,
              }),
            onCopied: (action) =>
              trackEvent(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, {
                action,
                ...properties,
              }),
          };
        }}
      />
      <PromptGuidance />
    </div>
  );
}
