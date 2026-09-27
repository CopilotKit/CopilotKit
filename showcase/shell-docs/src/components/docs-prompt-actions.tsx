"use client";

import React from "react";
import { usePostHog } from "posthog-js/react";
import { usePathname } from "next/navigation";
import { PromptPill } from "./prompt-pill";
import { PromptFolderHint } from "./hero-start-commands";
import { ViewOptionsPopover } from "./ai/page-actions";
import { pageSourceSentence } from "@/lib/onboarding-argument-templates";

/** Preserve the canonical page and source links when actions move into MDX. */
const PageContext = React.createContext<{
  markdownUrl: string;
  githubUrl: string;
  agentFramework?: string;
  frontend?: string;
} | null>(null);
export const DocsPromptActionsProvider = PageContext.Provider;

/** The same compact prompt and page menu in headers and setup sections. */
export function DocsPromptActions({
  createPrompt,
  copiedEvent = "docs.intelligence_onboarding_prompt_copied",
  includePageSource = false,
  ...props
}: Omit<React.ComponentProps<typeof PromptPill>, "createPrompt"> & {
  createPrompt: () => {
    text: string;
    analyticsProperties?: Record<string, unknown>;
  };
  /** Preserve existing surface-specific success events. */
  copiedEvent?: string;
  includePageSource?: boolean;
}) {
  const posthog = usePostHog();
  const pathname = usePathname();
  const page = React.useContext(PageContext);
  // The same line, in the same place, as under the docs hero (PE-340).
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="docs-page-tools docs-page-tools-prompt not-prose flex min-w-0 flex-row items-center">
        <PromptPill
          {...props}
          createPrompt={() => {
            const payload = createPrompt();
            const properties = {
              agent_framework: page?.agentFramework,
              frontend: page?.frontend,
              ...payload.analyticsProperties,
              from_path: pathname,
              surface: props.surface,
            };
            return {
              text: includePageSource
                ? payload.text +
                  pageSourceSentence(
                    page?.markdownUrl ??
                      `${pathname?.replace(/\/$/, "") || ""}.mdx`,
                  )
                : payload.text,
              onAction: (action) =>
                posthog?.capture(
                  "docs.intelligence_onboarding_prompt_action_clicked",
                  { ...properties, action },
                ),
              onCopied: (action) =>
                posthog?.capture(copiedEvent, {
                  ...properties,
                  action,
                }),
            };
          }}
        />
        <ViewOptionsPopover
          markdownUrl={
            page?.markdownUrl ?? `${pathname?.replace(/\/$/, "") || ""}.mdx`
          }
          githubUrl={page?.githubUrl}
          condensed
          includeCopyPage
        />
      </div>
      <PromptFolderHint />
    </div>
  );
}
