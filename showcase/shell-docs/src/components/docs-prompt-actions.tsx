"use client";

import React from "react";
import { usePostHog } from "posthog-js/react";
import { usePathname } from "next/navigation";
import { PromptPill } from "./prompt-pill";
import { ViewOptionsPopover } from "./ai/page-actions";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

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
  return (
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
              ? `${payload.text} The developer copied this prompt from ${getRuntimeConfig().baseUrl.replace(/\/+$/, "")}${page?.markdownUrl ?? `${pathname?.replace(/\/$/, "") || ""}.mdx`}.`
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
  );
}
