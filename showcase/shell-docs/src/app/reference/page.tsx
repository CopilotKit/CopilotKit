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
} from "@/lib/reference-items";
import type { ReferenceCategory, ReferenceItem } from "@/lib/reference-items";

function displayTitle(item: ReferenceItem): string {
  if (item.category === "Components") return `<${item.title} />`;
  if (item.category === "Hooks" || item.category === "Functions") {
    return `${item.title}()`;
  }
  return item.title;
}

function categoryItems(
  items: ReferenceItem[],
  category: ReferenceCategory,
): ReferenceItem[] {
  return items.filter((item) => item.category === category);
}

// SDK *families* shown as cards at the top of the Overview. This is not a
// 1:1 mapping of REFERENCE_VERSIONS — React v1 is a legacy version reachable
// via the sidebar picker, not its own card. The body below this chooser lists
// the React reference (the default landing); the sidebar picker switches SDKs.
const SDK_CHOICES: { name: string; description: string; href: string }[] = [
  {
    name: "React",
    description:
      "Hooks and components for building CopilotKit into a React app.",
    href: referenceVersionHref("v2"),
  },
  {
    name: "Core (TypeScript)",
    description:
      "The framework-agnostic @copilotkit/core client — runs anywhere JavaScript runs.",
    href: referenceVersionHref("core"),
  },
  {
    name: "Bots",
    description:
      "The bot stack — createBot, JSX message components, and the Slack adapter.",
    href: referenceVersionHref("bot"),
  },
];

export default function ReferencePage() {
  const activeVersion = "v2";
  const allItems = loadReferenceVersionItems(activeVersion);
  const pageTree = buildReferencePageTree(activeVersion);
  const intro =
    "Reference documentation for the CopilotKit SDKs. Pick the SDK you're building with, then browse its components, hooks, classes, and types.";
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
            Overview
          </h1>
          <p className="text-[var(--text-muted)] text-sm mb-10">{intro}</p>

          <section className="mb-12">
            <h2 className="text-lg font-semibold text-[var(--text)] mb-4">
              Choose your SDK
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SDK_CHOICES.map((sdk) => (
                <Link
                  key={sdk.name}
                  href={sdk.href}
                  className="block rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <div className="font-mono text-sm font-semibold text-[var(--accent)]">
                    {sdk.name}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">
                    {sdk.description}
                  </div>
                </Link>
              ))}
            </div>
          </section>

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
                      className="shell-docs-radius-surface block min-w-0 border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]"
                    >
                      <div className="min-w-0 break-words font-mono text-sm font-semibold text-[var(--accent)] [overflow-wrap:anywhere]">
                        {displayTitle(item)}
                      </div>
                      {item.description && (
                        <div className="mt-1 min-w-0 break-words text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
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
