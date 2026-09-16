"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { PromptPill } from "./prompt-pill";
import { ViewOptionsPopover } from "./ai/page-actions";

/** Preserve the canonical page and source links when actions move into MDX. */
const PageContext = React.createContext<{
  markdownUrl: string;
  githubUrl: string;
} | null>(null);
export const DocsPromptActionsProvider = PageContext.Provider;

/** The same compact prompt and page menu in headers and setup sections. */
export function DocsPromptActions(
  props: React.ComponentProps<typeof PromptPill>,
) {
  const pathname = usePathname();
  const page = React.useContext(PageContext);
  return (
    <div className="docs-page-tools docs-page-tools-prompt not-prose flex min-w-0 flex-row items-center">
      <PromptPill {...props} />
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
