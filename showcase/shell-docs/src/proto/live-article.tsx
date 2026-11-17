import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/spacious/page";
import {
  TOC,
  TOCDropdown,
  TOCPopover,
} from "fumadocs-ui/layouts/spacious/page/slots/toc";
import { Callout } from "fumadocs-ui/components/callout";
import Link from "next/link";
import { Feedback } from "@/components/feedback/client";
import { TrackedPageActions } from "@/components/telemetry/page-actions";
import { VisibleTOCProvider } from "@/components/layout/visible-toc";
import { docsPageComponents } from "@/components/docs-mdx";
import { setDocsScope } from "@/components/docs-mdx/page-store";
import { MissingDemoBanner } from "@/components/docs-mdx/showcase/snippet";
import { sendPageFeedback } from "@/lib/feedback";
import { Fragment } from "react";
import { gitConfig } from "@/lib/shared";
import type { ResolvedLivePage } from "@/lib/live-docs";
import { ROOT_FRAMEWORK } from "@/lib/live-scope";
import { isV1Reference, V1_DEPRECATION_NOTICE } from "@/lib/v1-deprecation";

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
    // The TOC always shows, whatever the page's `hideTOC` / `full` says, and
    // lists only the headings of the paths a reader picked.
    <DocsPage
      toc={toc}
      slots={{
        toc: {
          provider: VisibleTOCProvider,
          main: TOC,
          popover: TOCPopover,
          dropdown: TOCDropdown,
        },
      }}
    >
      {data.hideHeader ? null : (
        <>
          <DocsTitle className="text-[2.25rem] leading-[1.1] font-medium md:text-[2.5rem] tracking-[-0.03em] text-balance wrap-break-word">
            {breakIdentifiers(data.title)}
          </DocsTitle>
          {data.description ? (
            <DocsDescription className="mb-0">
              {data.description}
            </DocsDescription>
          ) : null}
        </>
      )}
      {data.hidePageActions ? null : (
        <TrackedPageActions
          markdownUrl={markdownUrl}
          className="flex flex-row gap-2 items-center border-b pb-6"
        >
          <MarkdownCopyButton
            markdownUrl={markdownUrl}
            className="font-mono"
            data-page-action="copy-markdown"
          />
          <ViewOptionsPopover
            className="font-mono"
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/showcase/shell-docs/src/content/${contentPath}`}
          />
        </TrackedPageActions>
      )}
      {scope.framework && typeof data.snippet_cell === "string" ? (
        <MissingDemoBanner
          framework={scope.framework}
          cell={data.snippet_cell}
          href={inFramework(url, scope.framework)}
        />
      ) : null}
      {isV1Reference(url) ? <V1DeprecationNotice /> : null}
      <DocsBody>
        {/* The same components snippet files get, links kept in scope. */}
        <MDX components={docsPageComponents(scope)} />
      </DocsBody>
      <Feedback onSendAction={sendPageFeedback} />
    </DocsPage>
  );
}

/** The warning atop every v1 reference page, as shell-docs' reference route drew it. */
function V1DeprecationNotice() {
  const notice = V1_DEPRECATION_NOTICE;
  return (
    <Callout type="warning">
      <strong>{notice.title}</strong> {notice.summary} {notice.importGuidance}
      <br />
      <strong>{notice.agentGuidance}</strong>{" "}
      <Link href={notice.migrationHref}>
        Read the v1 to v2 migration guide.
      </Link>{" "}
      <Link href={notice.exportMapHref}>Open the complete export map.</Link>
    </Callout>
  );
}

/** This page's URL on another framework, when the URL names its framework. */
function inFramework(url: string, framework: string) {
  const segments = url.split("/");
  const at = segments.indexOf(framework);
  if (at < 0) return undefined;
  // The built-in agent's pages are the unscoped ones (`/quickstart`).
  return (other: string) =>
    segments
      .flatMap((s, i) =>
        i !== at ? [s] : other === ROOT_FRAMEWORK ? [] : [other],
      )
      .join("/");
}

/**
 * A long identifier title (`CopilotKitCoreRuntimeConnectionStatus`) gets line
 * break opportunities at its word boundaries, so on a narrow screen it wraps
 * between "Runtime" and "Connection", not between two letters.
 */
function breakIdentifiers(title: string) {
  return title
    .split(/(\s+)/)
    .map((word, i) =>
      word.length < 16 ? (
        word
      ) : (
        <Fragment key={i}>
          {word
            .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[._/-])/)
            .flatMap((part, j) => (j ? [<wbr key={j} />, part] : [part]))}
        </Fragment>
      ),
    );
}
