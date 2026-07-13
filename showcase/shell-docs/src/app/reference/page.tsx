import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { Cards, Card } from "@/components/mdx-components";
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
    name: "React Native",
    description:
      "Headless provider, prebuilt UI, and hooks for building CopilotKit into a React Native app.",
    href: referenceVersionHref("react-native"),
  },
  {
    name: "Vue",
    description:
      "Composables and components for building CopilotKit into a Vue app.",
    href: referenceVersionHref("vue"),
  },
  {
    name: "Angular",
    description:
      "Components, services, and functions for building CopilotKit into an Angular app.",
    href: referenceVersionHref("angular"),
  },
  {
    name: "Core (TypeScript)",
    description:
      "The framework-agnostic @copilotkit/core client — runs anywhere JavaScript runs.",
    href: referenceVersionHref("core"),
  },
  {
    name: "Channels SDK",
    description:
      "Build chat-platform agents with createBot, JSX message components, and platform adapters.",
    href: referenceVersionHref("channels"),
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
        <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
          <DocsTitle className="text-[32px] md:text-[40px] font-medium leading-[1.2]">
            Overview
          </DocsTitle>
          <DocsDescription className="text-lg text-[var(--text-muted)] mt-5 leading-relaxed">
            {intro}
          </DocsDescription>

          <DocsBody className="reference-content prose-sm mt-8">
            <section>
              <h2>Choose your SDK</h2>
              <Cards>
                {SDK_CHOICES.map((sdk) => (
                  <Card
                    key={sdk.name}
                    href={sdk.href}
                    title={sdk.name}
                    description={sdk.description}
                  />
                ))}
              </Cards>
            </section>

            {REFERENCE_CATEGORIES.map((category) => {
              const items = categoryItems(allItems, category);
              if (items.length === 0) return null;

              return (
                <section key={category}>
                  <h2>
                    {category === "Components" ? "UI Components" : category}
                  </h2>
                  <Cards>
                    {items.map((item) => (
                      <Card
                        key={item.slug}
                        href={item.url}
                        title={displayTitle(item)}
                        description={item.description}
                      />
                    ))}
                  </Cards>
                </section>
              );
            })}
          </DocsBody>
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}
