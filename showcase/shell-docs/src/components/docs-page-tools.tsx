// DocsPageTools — the page-tools row that sits under a docs page's title:
// "Copy agent prompt", "Copy Markdown", and the "Open in <LLM>" popover.
// Fumadocs's upstream LLM page-actions feature.
//
// Extracted from `docs-page-view.tsx` so the row sits in a component small
// enough to unit-test. `DocsPageView` itself loads MDX off disk and builds the
// whole nav tree, so asserting the row's contents through it would mean
// standing up most of the docs pipeline.
//
// Every page that renders this row gets the onboarding button. `DocsPageView`
// is only reached by docs surfaces, and the button's offer — set CopilotKit up
// in this project — holds on all of them. Earlier revisions gated it on the
// caller naming a framework, which made identical pages behave differently
// depending on the URL the reader arrived through.

import React from "react";
import {
  MarkdownCopyButton,
  OnboardingPromptCopyButton,
  ViewOptionsPopover,
} from "@/components/ai/page-actions";

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
}: DocsPageToolsProps): React.JSX.Element {
  const markdownUrl = docsMarkdownUrl(slugHrefPrefix, slugPath);
  return (
    <div className="flex min-w-0 flex-row flex-wrap gap-2 items-center my-6">
      <OnboardingPromptCopyButton
        framework={onboardingFramework}
        markdownUrl={markdownUrl}
      />
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={githubUrl} />
    </div>
  );
}
