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
import { SidebarNav } from "@/components/sidebar-nav";
import {
  REFERENCE_CONTENT_DIR,
  loadAllReferenceItems,
  referenceStaticParams,
} from "@/lib/reference-items";
import { stripLeadingImports } from "@/lib/docs-render";
import { safeReadFileSync } from "@/lib/safe-fs";

// next-mdx-remote components map
const mdxComponents = {
  PropertyReference,
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
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
  const raw = safeReadFileSync(
    REFERENCE_CONTENT_DIR,
    `${slugPath}.mdx`,
  );
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

  return (
    <div className="flex min-h-[calc(100vh-53px)]">
      {/* Sidebar */}
      <SidebarNav className="hidden lg:block w-56 shrink-0 border-r border-[var(--border)] bg-[var(--bg-surface)] overflow-y-auto sticky top-[53px] h-[calc(100vh-53px)]">
        <nav className="p-4 space-y-6">
          <div>
            <Link
              href="/reference"
              className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              Reference
            </Link>
          </div>
          {["Components", "Hooks"].map((cat) => (
            <div key={cat}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                {cat}
              </div>
              <ul className="space-y-0.5">
                {allItems
                  .filter((i) => i.category === cat)
                  .map((item) => {
                    const isActive = item.slug === slugPath;
                    return (
                      <li key={item.slug}>
                        <Link
                          href={`/reference/${item.slug}`}
                          data-active={isActive ? "true" : undefined}
                          className={`block text-[12px] font-mono px-2 py-1 rounded transition-colors ${
                            isActive
                              ? "bg-[var(--accent)]/10 text-[var(--accent)] font-semibold"
                              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                          }`}
                        >
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>
      </SidebarNav>

      {/* Main content */}
      <article className="flex-1 min-w-0 max-w-3xl mx-auto px-6 py-10">
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
          <h1 className="text-2xl font-bold text-[var(--text)]">{title}</h1>
          {description && (
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {description}
            </p>
          )}
        </div>

        <div className="reference-content prose-sm">
          <MDXRemote source={cleanedContent} components={mdxComponents} />
        </div>
      </article>
    </div>
  );
}
