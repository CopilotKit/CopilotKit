// DocsPageTools — the compact split action that sits beside a docs page title.
// "Copy prompt" is the default action; its chevron progressively discloses
// "Copy page" and the existing "Open in <LLM>" destinations.
//
// Extracted from `docs-page-view.tsx` so the row sits in a component small
// enough to unit-test. `DocsPageView` itself loads MDX off disk and builds the
// whole nav tree, so asserting the row's contents through it would mean
// standing up most of the docs pipeline.
//
// Pages get the onboarding button by default. A page with its own focused
// prompt CTA can hide that one action while keeping the Markdown and LLM
// tools. Earlier revisions gated it on the caller naming a framework, which
// made identical pages behave differently depending on the URL the reader
// arrived through.

import React from "react";
import {
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "@/components/ai/page-actions";
import { OnboardingPromptButton } from "@/components/onboarding-prompt-button";

export interface DocsPageToolsProps {
  /** Slug path relative to `CONTENT_DIR` (no leading slash). */
  slugPath: string;
  /** Prefix used to build the page's own URL: `/<framework>`, `/cookbook`, … */
  slugHrefPrefix: string;
  /** Source file URL on GitHub for the "Open in GitHub" entry. */
  githubUrl: string;
  /**
   * The agent framework this page's docs are about. Present for pages served
   * under a `/<framework>/…` route, and equally for the root surface and the
   * cookbook, where the framework in play is the Built-in Agent. Absent only
   * where the surface has no registry record to name (`a2a`, `agent-spec`);
   * the button still renders there, its prompt simply names no framework.
   */
  onboardingFramework?: { slug: string; name: string };
  /**
   * The frontend the page's URL selects, resolved server-side by
   * `onboardingFrontendFor`. Named in the copied prompt right after the
   * framework, so the CLI's graph has to ask for neither selection.
   */
  onboardingFrontend?: { id: string; name: string };
  /** Hide the generic onboarding prompt when the page provides its own CTA. */
  hideOnboardingPrompt?: boolean;
}

/**
 * The page's `.mdx` URL as a site-root-relative path. The Next.js rewrite in
 * `next.config.ts` routes it to `/llms-mdx/[[...slug]]`, which re-runs the
 * same framework-aware content resolution the page uses. Built from the page
 * URL (rather than `contentSlugPath`) so the "View as Markdown" link the user
 * opens in a new tab stays visually aligned with the page they are reading.
 */
export function docsMarkdownUrl(
  slugHrefPrefix: string,
  slugPath: string,
): string {
  const base = `${slugHrefPrefix || ""}/${slugPath}`
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "/");
  return `${base.replace(/\/$/, "")}.mdx`;
}

export function DocsPageTools({
  slugPath,
  slugHrefPrefix,
  githubUrl,
  onboardingFramework,
  onboardingFrontend,
  hideOnboardingPrompt = false,
}: DocsPageToolsProps): React.JSX.Element {
  const markdownUrl = docsMarkdownUrl(slugHrefPrefix, slugPath);
  return (
    <div
      className="docs-page-tools flex min-w-0 flex-row items-center"
      role="group"
      aria-label="Page actions"
    >
      {hideOnboardingPrompt ? (
        <MarkdownCopyButton
          markdownUrl={markdownUrl}
          title="Copy page as Markdown"
          className="docs-page-actions-primary"
        >
          Copy page
        </MarkdownCopyButton>
      ) : (
        <OnboardingPromptButton
          variant="compact"
          surface="docs_page_tools_onboarding_prompt"
          framework={onboardingFramework}
          frontend={onboardingFrontend}
          markdownUrl={markdownUrl}
          className="docs-page-actions-primary"
        >
          Copy prompt
        </OnboardingPromptButton>
      )}
      <ViewOptionsPopover
        markdownUrl={markdownUrl}
        githubUrl={githubUrl}
        condensed
        includeCopyPage={!hideOnboardingPrompt}
      />
    </div>
  );
}
