import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { PropertyReference } from "@/components/property-reference";
import {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
} from "@/components/mdx-components";
import { SidebarNav } from "@/components/sidebar-nav";

const CONTENT_DIR = path.join(process.cwd(), "src/content/reference");

type NavItem = { slug: string; title: string; category: string };

function getAllItems(): NavItem[] {
  const items: NavItem[] = [];

  for (const subdir of ["components", "hooks"]) {
    const dir = path.join(CONTENT_DIR, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"))) {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const { data } = matter(raw);
      items.push({
        slug: `${subdir}/${f.replace(/\.mdx$/, "")}`,
        title: (data.title as string) || f.replace(/\.mdx$/, ""),
        category: subdir === "components" ? "Components" : "Hooks",
      });
    }
  }

  return items;
}

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
  const params: { slug: string[] }[] = [];

  for (const subdir of ["components", "hooks"]) {
    const dir = path.join(CONTENT_DIR, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"))) {
      params.push({ slug: [subdir, f.replace(/\.mdx$/, "")] });
    }
  }

  return params;
}

export default async function ReferenceSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const slugPath = slug.join("/");
  const filePath = path.join(CONTENT_DIR, `${slugPath}.mdx`);

  if (!fs.existsSync(filePath)) {
    notFound();
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const { content, data } = matter(raw);

  // Strip import lines — next-mdx-remote doesn't support them
  const cleanedContent = content
    .split("\n")
    .filter((line) => !line.match(/^import\s+/))
    .join("\n");

  const allItems = getAllItems();
  const title = (data.title as string) || slug[slug.length - 1];
  const description = data.description as string | undefined;

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
