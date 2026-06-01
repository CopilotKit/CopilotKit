import Link from "next/link";
import { DocsPage } from "fumadocs-ui/page";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { ReferenceVersionSelector } from "@/components/reference-version-selector";
import {
  REFERENCE_CATEGORIES,
  REFERENCE_VERSIONS,
  buildReferencePageTree,
  loadReferenceVersionItems,
  referenceVersionHref,
  readReferenceIndexDescription,
} from "@/lib/reference-items";
import type { ReferenceCategory, ReferenceItem } from "@/lib/reference-items";

function displayTitle(item: ReferenceItem): string {
  if (item.category === "Components") return `<${item.title} />`;
  if (item.category === "Hooks") return `${item.title}()`;
  return item.title;
}

function categoryItems(
  items: ReferenceItem[],
  category: ReferenceCategory,
): ReferenceItem[] {
  return items.filter((item) => item.category === category);
}

export default function ReferencePage() {
  const activeVersion = "v2";
  const allItems = loadReferenceVersionItems(activeVersion);
  const pageTree = buildReferencePageTree(activeVersion);
  const intro = readReferenceIndexDescription(activeVersion);
  const versionOptions = REFERENCE_VERSIONS.map((version) => ({
    version,
    href: referenceVersionHref(version),
  }));

  return (
    <ShellDocsLayout
      tree={pageTree}
      banner={
        <ReferenceVersionSelector
          activeVersion={activeVersion}
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
        <div className="docs-inner-content mx-auto max-w-4xl px-6 py-12">
          <h1 className="text-2xl font-bold text-[var(--text)] mb-2">
            API Reference
          </h1>
          <p className="text-[var(--text-muted)] text-sm mb-10">{intro}</p>

          {REFERENCE_CATEGORIES.map((category) => {
            const items = categoryItems(allItems, category);
            if (items.length === 0) return null;

            return (
              <section key={category} className="mb-10 last:mb-0">
                <h2 className="text-lg font-semibold text-[var(--text)] mb-4">
                  {category === "Components" ? "UI Components" : category}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {items.map((item) => (
                    <Link
                      key={item.slug}
                      href={item.url}
                      className="block rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <div className="font-mono text-sm font-semibold text-[var(--accent)]">
                        {displayTitle(item)}
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
            );
          })}
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}
