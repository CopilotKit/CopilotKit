// <Snippet>: code from a showcase cell, rendered like an MDX code fence.
// A port of shell-docs' src/components/snippet.tsx.
//
//   <Snippet region="provider-setup" cell="agentic-chat" />
//     the `@region[provider-setup]` block of the cell's source, or
//   <Snippet cell="chat-customization-css" file="src/app/.../theme.css" lines="1-40" />
//     a bundled file, optionally sliced to a 1-based inclusive line range.
//
// `region` wins over `file`. The framework is the explicit `framework` prop,
// else the page's URL framework, else the page's `snippet_framework`
// frontmatter (injected as `defaultFramework`); the cell is `cell`, else the
// page's `snippet_cell` (`defaultCell`). A missing region or file renders a
// visible notice instead of throwing, so pages degrade while authors iterate.

import type { ReactNode } from "react";
import Link from "next/link";
import { Callout } from "fumadocs-ui/components/callout";
import { DocsCode } from "../code";
import { getIntegration } from "../data";
import type { DocsScope } from "../scope";
import {
  missingDemo,
  parseLineRange,
  resolveSnippet,
  snippetFileName,
  type SnippetSourceProps,
} from "./sources";

export interface SnippetProps extends SnippetSourceProps {
  /** Accepted for source compatibility; the caption is always the file name. */
  title?: string;
  /** Hide the file-name caption. */
  noCaption?: boolean;
  /** Lines to emphasize, relative to the snippet: `"1-6"`, `"3,5-"`. */
  highlight?: string;
}

/** shell-docs' WarningBox: a docs gap the author should fix. */
function MissingSnippet({
  title = "Missing snippet",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Callout type="warn" title={title} role="alert">
      {children}
    </Callout>
  );
}

/**
 * The page's own cell has no demo on this framework, or the framework doesn't
 * support it: one notice at the top of the page (`LiveArticle`), as shell-docs
 * shows, in place of a notice per sample. `href` turns a framework slug into this page on that framework.
 */
export function MissingDemoBanner({
  framework,
  cell,
  href,
}: {
  framework: string;
  cell: string;
  href?: (framework: string) => string;
}) {
  const missing = missingDemo(framework, cell);
  if (!missing) return null;
  if (missing.kind === "unsupported") {
    return (
      <UnsupportedBox
        integrationName={missing.integrationName}
        featureName={missing.featureName}
      />
    );
  }
  const { name, others } = missing;
  return (
    <Callout type="info" title={`Not available for ${name} yet`}>
      The code on this page comes from the showcase&apos;s <code>{cell}</code>{" "}
      demo, and {name} doesn&apos;t have it yet.
      {href ? (
        <>
          {" "}
          See this page for{" "}
          {others.slice(0, 3).map((slug, i) => (
            <span key={slug}>
              {i > 0 ? ", " : null}
              <Link href={href(slug)}>
                {getIntegration(slug)?.name ?? slug}
              </Link>
            </span>
          ))}
          .
        </>
      ) : null}
    </Callout>
  );
}

/**
 * The catalog marks this framework's demo not supported: the framework
 * doesn't implement the feature, or its demo can't run yet (a quarantined
 * cell). Neutral wording, since it can be either; an expected
 * state the catalog records, not a docs gap.
 */
export function UnsupportedBox({
  integrationName,
  featureName,
}: {
  integrationName: string;
  featureName: string;
}) {
  return (
    <Callout type="info" title={`Not available for ${integrationName} yet`}>
      The {featureName} demo for {integrationName} can&apos;t run yet, so its
      code isn&apos;t shown here. See <Link href="/">the framework grid</Link>{" "}
      for the frameworks where it runs.
    </Callout>
  );
}

/** The bundler's coarse language hints, as Shiki language names. */
const SHIKI_LANGUAGE: Record<string, string> = { text: "plaintext" };

export function shikiLanguage(lang: string): string {
  return SHIKI_LANGUAGE[lang] ?? lang;
}

function parseHighlightedLines(
  input: string | undefined,
  totalLines: number,
): Set<number> | undefined {
  if (!input) return undefined;
  const lines = new Set<number>();
  for (const part of input.split(",")) {
    const range = parseLineRange(part);
    if (!range) return undefined;
    const end = Math.min(range[1], totalLines);
    for (let line = range[0]; line <= end; line++) lines.add(line);
  }
  return lines.size ? lines : undefined;
}

export async function Snippet({
  scope,
  noCaption,
  highlight,
  ...props
}: SnippetProps & { scope: DocsScope }) {
  const { region, file } = props;
  const source = resolveSnippet(props, scope);
  switch (source.kind) {
    case "code":
      return (
        <DocsCode
          code={source.code}
          lang={shikiLanguage(source.language)}
          title={
            noCaption
              ? undefined
              : snippetFileName(source.file.split("/").pop() ?? source.file)
          }
          highlightLines={parseHighlightedLines(
            highlight,
            source.code.split("\n").length,
          )}
        />
      );
    case "hidden":
      return null;
    case "no-source":
      return (
        <MissingSnippet>
          <code>&lt;Snippet /&gt;</code> needs either <code>region</code> or{" "}
          <code>file</code>: <code>region=&quot;my-region&quot;</code> for a
          tagged block, or{" "}
          <code>file=&quot;src/...&quot; lines=&quot;10-20&quot;</code> for a
          file.
        </MissingSnippet>
      );
    case "no-framework":
      return (
        <Callout>Select an AI backend above to see this code example.</Callout>
      );
    case "no-cell":
      return (
        <MissingSnippet>
          <code>
            {`<Snippet ${region ? `region="${region}"` : `file="${file}"`} />`}
          </code>{" "}
          has no cell (framework <code>{source.framework}</code>). Pass{" "}
          <code>cell=&quot;...&quot;</code> or set <code>snippet_cell</code> in
          the page frontmatter.
        </MissingSnippet>
      );
    case "unsupported":
      return (
        <UnsupportedBox
          integrationName={source.integrationName}
          featureName={source.featureName}
        />
      );
    case "not-yet":
      return (
        <Callout type="info" title={`Not available for ${source.name} yet`}>
          This sample comes from the showcase&apos;s <code>{source.cell}</code>{" "}
          demo, and {source.name} doesn&apos;t have it yet.
        </Callout>
      );
    case "no-demo":
      return (
        <MissingSnippet>
          No demo found for <code>{source.key}</code>. Check the cell id and
          framework slug.
        </MissingSnippet>
      );
    case "no-region":
      return (
        <MissingSnippet>
          Region <code>{source.region}</code> not found in{" "}
          <code>{source.key}</code>. Tag the source lines with{" "}
          <code>{`// @region[${source.region}]`}</code> /{" "}
          <code>{`// @endregion[${source.region}]`}</code>.
          {source.available.length > 0 ? (
            <span className="mt-1 block text-xs">
              Available: {source.available.join(", ")}
            </span>
          ) : null}
        </MissingSnippet>
      );
    case "no-file":
      return (
        <MissingSnippet>
          File <code>{source.file}</code> isn&apos;t bundled in{" "}
          <code>{source.key}</code>. Check the path (relative to the cell root).
          {source.available.length > 0 ? (
            <span className="mt-1 block text-xs">
              Available: {source.available.slice(0, 6).join(", ")}
              {source.available.length > 6
                ? ` (+${source.available.length - 6} more)`
                : ""}
            </span>
          ) : null}
        </MissingSnippet>
      );
    case "bad-lines":
      return <MissingSnippet>{source.warning}</MissingSnippet>;
    case "no-code":
      return (
        <MissingSnippet>
          The snippet for <code>{source.key}</code> has no code;
          demo-content.json may be malformed or out of date.
        </MissingSnippet>
      );
  }
}
