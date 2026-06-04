import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import matter from "gray-matter";
import { LinkIcon } from "lucide-react";
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
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { ReferenceVersionSelector } from "@/components/reference-version-selector";
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
    <div className="my-6 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      {children}
    </div>
  ),
  // Strip unknown imports — MDX import statements become no-ops in next-mdx-remote
};

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

  const { version, pageSlug, contentSlug, raw } = resolved;
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
  const versionOptions = REFERENCE_VERSIONS.map((referenceVersion) => ({
    version: referenceVersion,
    href: referenceVersionHref(referenceVersion, pageSlug),
  }));

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
        <div className="px-6 py-10 max-w-3xl mx-auto">
          <div className="mb-8">
            <div className="text-xs text-[var(--text-muted)] mb-2">
              <Link
                href="/reference"
                className="hover:text-[var(--text-secondary)]"
              >
                Reference
              </Link>
              {" / "}
              <span>{version}</span>
              {pageSlug && (
                <>
                  {" / "}
                  <span className="capitalize">{pageSlug.split("/")[0]}</span>
                </>
              )}
            </div>
            <DocsTitle className="text-2xl font-bold">{title}</DocsTitle>
            {description && (
              <DocsDescription className="text-sm mt-1">
                {description}
              </DocsDescription>
            )}
          </div>

          <DocsBody className="reference-content prose-sm">
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
      </DocsPage>
    </ShellDocsLayout>
  );
}
