import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import matter from "gray-matter";
import { PropertyReference } from "@/components/property-reference";
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
import type * as PageTree from "fumadocs-core/page-tree";
import {
  REFERENCE_CONTENT_DIR,
  loadAllReferenceItems,
  referenceStaticParams,
} from "@/lib/reference-items";
import { stripLeadingImports } from "@/lib/docs-render";
import { safeReadFileSync } from "@/lib/safe-fs";
import { getBaseUrl } from "@/lib/sitemap-helpers";

// Self-canonical for /reference/<slug>. Reference pages are not
// per-framework, but we still emit a canonical so the production URL
// is unambiguous and any future host aliases can't fragment indexing.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    alternates: {
      canonical: `${getBaseUrl()}/reference/${slug.join("/")}`,
    },
  };
}

// next-mdx-remote components map
const mdxComponents = {
  PropertyReference,
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  OpsPlatformCTA,
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
  const slugPath = slug.join("/");
  // slugPath is user-supplied (URL segments). Route the filesystem read
  // through safeReadFileSync so crafted paths like `..%2F..%2Fsecrets`
  // can't escape REFERENCE_CONTENT_DIR.
  const raw = safeReadFileSync(REFERENCE_CONTENT_DIR, `${slugPath}.mdx`);
  if (raw === null) {
    notFound();
  }

  let content = "";
  let data: Record<string, unknown> = {};
  try {
    const parsed = matter(raw);
    content = parsed.content;
    data = parsed.data;
  } catch (err) {
    console.error(
      `[reference] Failed to parse frontmatter in ${slugPath}.mdx:`,
      err,
    );
    notFound();
  }

  const cleanedContent = stripLeadingImports(content);

  const allItems = loadAllReferenceItems();
  const title =
    typeof data.title === "string" && data.title.length > 0
      ? data.title
      : slug[slug.length - 1];
  const description =
    typeof data.description === "string" ? data.description : undefined;

  // Build a Fumadocs PageTree from the reference items, grouped by
  // category. Reference's IA is its own (Components / Hooks) — we don't
  // share the docs nav tree here.
  const pageTree: PageTree.Root = {
    name: "Reference",
    children: ["Components", "Hooks"].flatMap((cat) => [
      { type: "separator" as const, name: cat },
      ...allItems
        .filter((i) => i.category === cat)
        .map(
          (item): PageTree.Item => ({
            type: "page",
            name: item.title,
            url: `/reference/${item.slug}`,
          }),
        ),
    ]),
  };

  return (
    <ShellDocsLayout tree={pageTree}>
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
              <span className="capitalize">{slug[0]}</span>
            </div>
            <DocsTitle className="text-2xl font-bold">{title}</DocsTitle>
            {description && (
              <DocsDescription className="text-sm mt-1">
                {description}
              </DocsDescription>
            )}
          </div>

          <DocsBody className="reference-content prose-sm">
            <MDXRemote source={cleanedContent} components={mdxComponents} />
          </DocsBody>
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}
