import Link from "next/link";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { DocsPage } from "fumadocs-ui/page";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import type * as PageTree from "fumadocs-core/page-tree";
import {
  REFERENCE_CONTENT_DIR,
  loadReferenceItems,
  loadAllReferenceItems,
} from "@/lib/reference-items";

export default function ReferencePage() {
  const components = loadReferenceItems("components");
  const hooks = loadReferenceItems("hooks");
  const allItems = loadAllReferenceItems();

  // Mirror the PageTree built by `/reference/[...slug]` so the sidebar
  // chrome is identical between the index and the per-item pages.
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

  // Also load the index page frontmatter for the intro. Guarded so a
  // malformed frontmatter block falls back to a default rather than
  // crashing the whole index page.
  let intro = "API Reference for the next-generation CopilotKit React API.";
  const indexPath = path.join(REFERENCE_CONTENT_DIR, "index.mdx");
  if (fs.existsSync(indexPath)) {
    try {
      const { data } = matter(fs.readFileSync(indexPath, "utf-8"));
      if (typeof data.description === "string" && data.description.length > 0) {
        intro = data.description;
      }
    } catch (err) {
      console.error(
        `[reference] Failed to parse frontmatter in ${indexPath}:`,
        err,
      );
    }
  }

  return (
    <ShellDocsLayout tree={pageTree}>
      <DocsPage
        toc={[]}
        tableOfContent={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
      >
        <div className="docs-inner-content mx-auto max-w-4xl px-6 py-12">
          <h1 className="text-2xl font-bold text-[var(--text)] mb-2">
            API Reference
          </h1>
          <p className="text-[var(--text-muted)] text-sm mb-10">{intro}</p>

          <section className="mb-10">
            <h2 className="text-lg font-semibold text-[var(--text)] mb-4">
              UI Components
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {components.map((item) => (
                <Link
                  key={item.slug}
                  href={`/reference/${item.slug}`}
                  className="block rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <div className="font-mono text-sm font-semibold text-[var(--accent)]">
                    {"<"}
                    {item.title}
                    {" />"}
                  </div>
                  {item.description && (
                    <div className="text-xs text-[var(--text-muted)] mt-1">
                      {item.description}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--text)] mb-4">
              Hooks
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {hooks.map((item) => (
                <Link
                  key={item.slug}
                  href={`/reference/${item.slug}`}
                  className="block rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <div className="font-mono text-sm font-semibold text-[var(--accent)]">
                    {item.title}()
                  </div>
                  {item.description && (
                    <div className="text-xs text-[var(--text-muted)] mt-1">
                      {item.description}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}
