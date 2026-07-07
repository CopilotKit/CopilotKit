import type { Metadata } from "next";
import type React from "react";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import matter from "gray-matter";
import { ChevronRight, LinkIcon } from "lucide-react";
import remarkGfm from "remark-gfm";
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import { PropertyReference } from "@/components/property-reference";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { transformerMeta } from "@/lib/rehype-code-meta";
import {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
} from "@/components/mdx-components";
import {
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "@/components/ai/page-actions";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { ReferenceVersionSelector } from "@/components/reference-version-selector";
import { EarlyAccessGate } from "@/components/early-access-gate";
import {
  REFERENCE_VERSIONS,
  buildReferencePageTree,
  referenceHref,
  referenceStaticParams,
  referenceVersionHref,
  resolveReferencePage,
} from "@/lib/reference-items";
import { stripLeadingImports } from "@/lib/docs-render";
import { buildDocMetadata } from "@/lib/seo-metadata";
import { getEarlyAccessGate } from "@/lib/early-access";

// Self-canonical for /reference/<slug>. Reference pages are not
// per-framework, but we still emit a canonical so the production URL
// is unambiguous and any future host aliases can't fragment indexing.
// Title/description come from the page's MDX frontmatter so each API
// reference page emits its own social card and SEO description rather
// than inheriting the layout's generic site-wide values.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = resolveReferencePage(slug);
  const raw = resolved?.raw ?? null;
  let title: string | undefined;
  let description: string | undefined;
  if (raw !== null) {
    try {
      const { data } = matter(raw);
      if (typeof data.title === "string" && data.title.length > 0) {
        title = data.title;
      }
      if (typeof data.description === "string" && data.description.length > 0) {
        description = data.description;
      }
    } catch {
      // Malformed frontmatter — fall back to slug-derived title.
    }
  }
  return buildDocMetadata({
    title: title ?? slug[slug.length - 1],
    description,
    canonicalPath: resolved
      ? referenceHref(resolved.version, resolved.pageSlug)
      : `/reference/${slug.join("/")}`,
  });
}

// next-mdx-remote components map
const mdxComponents = {
  PropertyReference,
  // Render fenced code blocks through the same Shiki + Fumadocs CodeBlock
  // chrome the main docs use (syntax highlighting + copy button), paired with
  // the rehypeCode plugin wired into the MDXRemote options below.
  pre: MdxCodeBlock,
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  OpsPlatformCTA,
  LinkIcon,
  Frame: ({ children }: { children: React.ReactNode }) => (
    <div className="shell-docs-radius-surface my-6 border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-control)]">
      {children}
    </div>
  ),
  // Strip unknown imports — MDX import statements become no-ops in next-mdx-remote
};

function buildGitHubUrl(absFilePath: string): string {
  const marker = "/showcase/";
  const idx = absFilePath.indexOf(marker);
  const repoRelative =
    idx >= 0 ? absFilePath.slice(idx + 1) : "showcase/shell-docs";
  return `https://github.com/CopilotKit/CopilotKit/blob/main/${repoRelative}`;
}

function categoryLabel(pageSlug: string): string | null {
  const category = pageSlug.split("/").filter(Boolean)[0];
  if (!category) return null;
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function generateStaticParams() {
  return referenceStaticParams();
}

export default async function ReferenceSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const resolved = resolveReferencePage(slug);
  if (resolved === null) {
    notFound();
  }

  const { version, pageSlug, contentSlug, filePath, raw } = resolved;
  let content = "";
  let data: Record<string, unknown> = {};
  try {
    const parsed = matter(raw);
    content = parsed.content;
    data = parsed.data;
  } catch (err) {
    console.error(
      `[reference] Failed to parse frontmatter in ${contentSlug}.mdx:`,
      err,
    );
    notFound();
  }

  const cleanedContent = stripLeadingImports(content);

  const title =
    typeof data.title === "string" && data.title.length > 0
      ? data.title
      : slug[slug.length - 1];
  const description =
    typeof data.description === "string" ? data.description : undefined;
  const pageTree = buildReferencePageTree(version);
  const markdownUrl = `${referenceHref(version, pageSlug).replace(/\/$/, "")}.mdx`;
  const versionOptions = REFERENCE_VERSIONS.map((referenceVersion) => ({
    version: referenceVersion,
    href: referenceVersionHref(referenceVersion, pageSlug),
  }));
  const breadcrumbs = [
    { label: "Reference", href: "/reference" },
    { label: version, href: referenceVersionHref(version) },
    ...(categoryLabel(pageSlug)
      ? [{ label: categoryLabel(pageSlug) ?? "", href: null }]
      : []),
  ];

  return (
    <ShellDocsLayout
      tree={pageTree}
      banner={
        <ReferenceVersionSelector
          activeVersion={version}
          options={versionOptions}
        />
      }
    >
      <DocsPage
        toc={[]}
        tableOfContent={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
      >
        {/* The whole `bot` reference section documents the Slack bot
            SDK, so it sits behind the same early-access gate as the
            Slack guide. */}
        <MaybeEarlyAccessGate gate={version === "bot" ? "slack" : undefined}>
          <div className="docs-inner-content shell-docs-reading-page max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
            <nav className="mb-2 flex flex-wrap items-center gap-1 text-[11px] font-medium leading-none text-[var(--muted-foreground)]">
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                const labelClass = `truncate ${isLast ? "text-[var(--foreground)] font-medium" : ""}`;
                return (
                  <Fragment key={`${crumb.label}-${i}`}>
                    {i > 0 && (
                      <ChevronRight
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    {crumb.href && !isLast ? (
                      <Link
                        href={crumb.href}
                        className={`${labelClass} transition-opacity hover:opacity-80`}
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className={labelClass}>{crumb.label}</span>
                    )}
                  </Fragment>
                );
              })}
            </nav>

            <DocsTitle className="text-[32px] md:text-[40px] font-medium leading-[1.2]">
              {title}
            </DocsTitle>
            {description && (
              <DocsDescription className="text-lg text-[var(--muted-foreground)] mt-5 leading-relaxed">
                {description}
              </DocsDescription>
            )}

            <div className="flex min-w-0 flex-row flex-wrap gap-2 items-center my-6">
              <MarkdownCopyButton markdownUrl={markdownUrl} />
              <ViewOptionsPopover
                markdownUrl={markdownUrl}
                githubUrl={buildGitHubUrl(filePath)}
              />
            </div>

            <hr className="border-t border-[var(--border)] mt-2 mb-6" />

            <DocsBody className="reference-content">
              <MDXRemote
                source={cleanedContent}
                components={mdxComponents}
                options={{
                  mdxOptions: {
                    remarkPlugins: [remarkGfm],
                    rehypePlugins: [
                      [
                        rehypeCode,
                        {
                          fallbackLanguage: "plaintext",
                          transformers: [
                            ...(rehypeCodeDefaultOptions.transformers ?? []),
                            transformerMeta(),
                          ],
                        },
                      ],
                    ],
                  },
                }}
              />
            </DocsBody>
          </div>
        </MaybeEarlyAccessGate>
      </DocsPage>
    </ShellDocsLayout>
  );
}

function MaybeEarlyAccessGate({
  gate,
  children,
}: {
  gate?: string;
  children: React.ReactNode;
}) {
  if (!gate || !getEarlyAccessGate(gate)) return <>{children}</>;
  return <EarlyAccessGate gate={gate}>{children}</EarlyAccessGate>;
}
