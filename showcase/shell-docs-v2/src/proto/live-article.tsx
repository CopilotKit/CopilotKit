import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/spacious/page";
import { Feedback } from "@/components/feedback/client";
import { docsPageComponents } from "@/components/docs-mdx";
import { setDocsScope } from "@/components/docs-mdx/page-store";
import { sendPageFeedback } from "@/lib/feedback";
import { gitConfig } from "@/lib/shared";
import type { ResolvedLivePage } from "@/lib/live-docs";

/** A page ported from shell-docs, at its live URL, in D's docs panel. */
export async function LiveArticle({
  page,
  scope,
  contentPath,
  url,
}: ResolvedLivePage & {
  /** The URL it was reached at; `page.url` is the unscoped one. */
  url: string;
}) {
  // Components and snippet files deep in the page read its scope from here.
  setDocsScope(scope, { path: contentPath, frontmatter: page.data });
  const { body: MDX, toc } = await page.data.load();
  const data = page.data;
  const markdownUrl = `${url}.md`;

  return (
    // The TOC always shows, whatever the page's `hideTOC` / `full` says.
    <DocsPage toc={toc}>
      {data.hideHeader ? null : (
        <>
          <DocsTitle className="text-[2.25rem] leading-[1.1] font-medium md:text-[2.5rem] tracking-[-0.03em] text-balance">
            {data.title}
          </DocsTitle>
          {data.description ? (
            <DocsDescription className="mb-0">
              {data.description}
            </DocsDescription>
          ) : null}
        </>
      )}
      {data.hidePageActions ? null : (
        <div className="flex flex-row gap-2 items-center border-b pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} className="font-mono" />
          <ViewOptionsPopover
            className="font-mono"
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/showcase/shell-docs/src/content/${contentPath}`}
          />
        </div>
      )}
      <DocsBody>
        {/* The same components snippet files get, links kept in scope. */}
        <MDX components={docsPageComponents(scope)} />
      </DocsBody>
      <Feedback onSendAction={sendPageFeedback} />
    </DocsPage>
  );
}
