import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import matter from "gray-matter";
import { Callout } from "@/components/mdx-components";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { DocsContentHeader } from "@/components/docs-content-header";
import { DocsPageTools } from "@/components/docs-page-tools";
import { ReferenceVersionSelector } from "@/components/reference-version-selector";
import {
  REFERENCE_VERSIONS,
  buildReferencePageTree,
  referenceHref,
  referenceStaticParams,
  referenceVersionHref,
  resolveReferencePage,
} from "@/lib/reference-items";
import {
  prepareReferenceSource,
  referenceMdxComponents,
  referenceMdxOptions,
} from "@/lib/reference-mdx";
import { buildDocMetadata } from "@/lib/seo-metadata";
import { V1_DEPRECATION_NOTICE_USE_V2_INSTEAD } from "@/lib/v1-deprecation-use-v2-instead";

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

  const cleanedContent = prepareReferenceSource(content, contentSlug);

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
        <div className="docs-inner-content docs-article-content mx-auto px-4 pb-6 pt-2 md:px-6 md:pt-3 xl:pt-4">
          <DocsContentHeader
            ancestorBreadcrumbs={breadcrumbs}
            title={title}
            description={description}
          >
            <DocsPageTools
              slugPath={pageSlug}
              slugHrefPrefix={`/reference/${version}`}
              githubUrl={buildGitHubUrl(filePath)}
            />
          </DocsContentHeader>

          {version === "v1" && (
            <div className="mb-6">
              <Callout type="warning">
                <strong>{V1_DEPRECATION_NOTICE_USE_V2_INSTEAD.title}</strong>{" "}
                {V1_DEPRECATION_NOTICE_USE_V2_INSTEAD.summary}{" "}
                {V1_DEPRECATION_NOTICE_USE_V2_INSTEAD.importGuidance}
                <br />
                <strong>
                  {V1_DEPRECATION_NOTICE_USE_V2_INSTEAD.agentGuidance}
                </strong>{" "}
                <Link href={V1_DEPRECATION_NOTICE_USE_V2_INSTEAD.migrationHref}>
                  Read the v1 to v2 migration guide.
                </Link>{" "}
                <Link href={V1_DEPRECATION_NOTICE_USE_V2_INSTEAD.exportMapHref}>
                  Open the complete export map.
                </Link>
              </Callout>
            </div>
          )}

          <DocsBody className="reference-content">
            <MDXRemote
              source={cleanedContent}
              components={referenceMdxComponents}
              options={referenceMdxOptions}
            />
          </DocsBody>
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}
