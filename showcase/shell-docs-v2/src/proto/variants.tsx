"use client";

import type * as PageTree from "fumadocs-core/page-tree";
import {
  AgentsGlyph,
  BackendGlyph,
  BasicsGlyph,
  CapabilitiesGlyph,
  DirectoryGlyph,
  DocsGlyph,
  GenerativeUIGlyph,
  IntelligenceGlyph,
  InteractivityGlyph,
  OtherGlyph,
  QuickstartGlyph,
} from "@/components/icons/glyphs";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import {
  FRAMEWORKS,
  INTELLIGENCE_PAGES,
  LANGUAGES,
  TOPICS,
  frameworkById,
  type Language,
} from "./data";
import { navForFramework, type NavIcon, type NavItem } from "./nav-d";
import { FrameworkMenu, FrontendMenu, StackRows } from "./pieces";
import { rememberFramework } from "./last-framework";
import {
  frameworkHref,
  sectionHref,
  type Location,
  type VariantId,
} from "./routes";

export { VARIANTS, variantMeta } from "./meta";

/* ---------- sidebar trees ---------- */

const page = (
  name: string,
  url: string,
  icon?: React.ReactNode,
): PageTree.Item => ({
  type: "page",
  name,
  url,
  icon,
});
const sep = (name: string): PageTree.Separator => ({ type: "separator", name });
const logo = (id: string) => <FrameworkLogo slug={id} size={16} />;

function intelligenceNodes(variant: VariantId): PageTree.Node[] {
  return [
    sep("Intelligence"),
    page(
      "Intelligence overview",
      sectionHref(variant, "intelligence"),
      <IntelligenceGlyph />,
    ),
  ];
}

function frameworkTopics(variant: VariantId, fw: string): PageTree.Node[] {
  return [
    sep("Get started"),
    page("Quickstart", frameworkHref(variant, fw, "quickstart")),
    sep("Build"),
    ...TOPICS.filter((t) => t.slug !== "quickstart").map((t) =>
      page(t.title, frameworkHref(variant, fw, t.slug)),
    ),
  ];
}

function neutralTopics(variant: VariantId): PageTree.Node[] {
  return [
    sep("Build"),
    ...TOPICS.filter((t) => t.slug !== "quickstart").map((t) =>
      page(t.title, sectionHref(variant, "docs", t.slug)),
    ),
  ];
}

const NAV_ICONS: Record<NavIcon, React.ReactNode> = {
  play: <QuickstartGlyph />,
  brain: <AgentsGlyph />,
  kite: <IntelligenceGlyph />,
  sprout: <BasicsGlyph />,
  layout: <GenerativeUIGlyph />,
  pointer: <InteractivityGlyph />,
  sparkles: <CapabilitiesGlyph />,
  server: <BackendGlyph />,
  book: <DocsGlyph />,
  wrench: <OtherGlyph />,
};

/**
 * Every sidebar section heading and its glyph take the same accent: the
 * sidebar's lilac, which clears 4.5:1 on the frame in both themes.
 */
const SECTION_ACCENT = "text-sidebar-primary";

/** D mirrors the live docs sidebar, Intelligence included. */
function dTree(fwId: string): PageTree.Root {
  const fw = frameworkById(fwId) ?? frameworkById("mastra")!;
  const node = (item: NavItem): PageTree.Node => {
    if (item.kind === "folder") {
      return {
        type: "folder",
        name: item.title,
        defaultOpen: item.defaultOpen,
        children: item.items.map(node),
      };
    }
    if (item.kind === "link") return page(item.title, item.url);
    if (item.kind === "external") {
      return { type: "page", name: item.title, url: item.url, external: true };
    }
    return page(
      item.title,
      item.section === "intelligence"
        ? sectionHref("d", "intelligence", item.slug || undefined)
        : frameworkHref("d", fw.id, item.slug || undefined),
      // Top-level page icons (Quickstart, Build with agents, Intelligence)
      // take the section headings' accent.
      item.icon ? (
        <span className={SECTION_ACCENT}>{NAV_ICONS[item.icon]}</span>
      ) : undefined,
    );
  };
  return {
    name: fw.name,
    children: navForFramework(fw).flatMap((s) => [
      ...(s.title
        ? [
            {
              ...sep(s.title),
              name: <span className={SECTION_ACCENT}>{s.title}</span>,
              icon: s.icon ? (
                <span className={SECTION_ACCENT}>{NAV_ICONS[s.icon]}</span>
              ) : undefined,
            },
          ]
        : []),
      ...s.items.map(node),
    ]),
  };
}

export function buildTree(
  variant: VariantId,
  loc: Location | null,
  /** D's last framework, for its Intelligence pages. */
  lastFramework?: string,
): PageTree.Root {
  if (variant === "d" && loc && loc.kind !== "docs") {
    return dTree(
      loc.kind === "framework" ? loc.framework : (lastFramework ?? "mastra"),
    );
  }
  if (loc?.kind === "intelligence") {
    return {
      name: "Intelligence",
      children: [
        ...INTELLIGENCE_PAGES.map((p) =>
          page(
            p.title,
            sectionHref(variant, "intelligence", p.slug || undefined),
          ),
        ),
        sep(" "),
        page("Back to the docs", sectionHref(variant, "docs"), <DocsGlyph />),
      ],
    };
  }

  if (variant === "c") {
    if (loc?.kind === "integrations" || loc?.kind === "framework") {
      const current = loc.kind === "framework" ? loc.framework : undefined;
      const group = (lang: Language): PageTree.Node[] => [
        sep(lang),
        ...FRAMEWORKS.filter((f) => f.language === lang).map<PageTree.Folder>(
          (f) => ({
            type: "folder",
            name: f.name,
            icon: logo(f.id),
            defaultOpen: f.id === current,
            index: page(
              "Quickstart",
              frameworkHref(variant, f.id, "quickstart"),
            ),
            children: TOPICS.filter((t) => t.slug !== "quickstart").map((t) =>
              page(t.title, frameworkHref(variant, f.id, t.slug)),
            ),
          }),
        ),
      ];
      return {
        name: "Integrations",
        children: [
          page(
            "All integrations",
            sectionHref(variant, "integrations"),
            <DirectoryGlyph />,
          ),
          ...LANGUAGES.flatMap(group),
        ],
      };
    }
    // Docs section: Supabase's quickstart list, then framework-neutral features.
    return {
      name: "Docs",
      children: [
        page("Getting started", sectionHref(variant, "docs")),
        sep("Agent quickstarts"),
        ...FRAMEWORKS.map((f) =>
          page(f.name, frameworkHref(variant, f.id, "quickstart"), logo(f.id)),
        ),
        ...neutralTopics(variant),
      ],
    };
  }

  // A and B: the framework is the first URL segment.
  if (loc?.kind === "framework") {
    const fw = loc.framework;
    return {
      name: frameworkById(fw)?.name ?? fw,
      children: [
        page("Introduction", sectionHref(variant, "docs")),
        ...(variant === "b"
          ? [
              page(
                `${frameworkById(fw)?.short} overview`,
                frameworkHref(variant, fw),
                logo(fw),
              ),
            ]
          : []),
        ...frameworkTopics(variant, fw),
        ...intelligenceNodes(variant),
      ],
    };
  }
  return {
    name: "Docs",
    children: [
      page("Introduction", sectionHref(variant, "docs")),
      ...(variant === "b"
        ? [
            page(
              "Integrations",
              sectionHref(variant, "integrations"),
              <DirectoryGlyph />,
            ),
          ]
        : []),
      ...neutralTopics(variant),
      ...intelligenceNodes(variant),
    ],
  };
}

/** C's section menu: Fumadocs layout tabs. */
export function layoutTabs(variant: VariantId) {
  if (variant !== "c") return undefined;
  return [
    {
      title: "Docs",
      description: "Concepts and features",
      url: sectionHref(variant, "docs"),
      icon: <DocsGlyph />,
    },
    {
      title: "Integrations",
      description: "Every agent framework",
      url: sectionHref(variant, "integrations"),
      icon: <DirectoryGlyph />,
    },
    {
      title: "Intelligence",
      description: "Threads, memory, learning",
      url: sectionHref(variant, "intelligence"),
      icon: <IntelligenceGlyph />,
    },
  ];
}

/** What sits at the top of the sidebar, above search. */
export function SidebarTop({
  variant,
  loc,
  lastFramework,
}: {
  variant: VariantId;
  loc: Location | null;
  lastFramework?: string;
}) {
  const fw = loc?.kind === "framework" ? loc.framework : undefined;
  const slug = loc?.kind === "framework" ? loc.slug : "";
  if (variant === "d" && loc?.kind === "intelligence") {
    // Intelligence pages aren't per framework: switching keeps the page.
    return (
      <StackRows
        variant={variant}
        framework={lastFramework ?? "mastra"}
        slug=""
        onFramework={rememberFramework}
      />
    );
  }
  if (loc?.kind === "intelligence" && variant !== "c") return null;
  switch (variant) {
    case "a":
      return (
        <FrameworkMenu
          variant={variant}
          current={fw}
          slug={slug}
          look="tabs-menu"
        />
      );
    case "b":
      return (
        <div className="rounded-xl border bg-fd-card p-2 shadow-sm">
          <FrameworkMenu
            variant={variant}
            current={fw}
            slug={slug}
            look="labelled"
            label="Select your agent framework"
          />
        </div>
      );
    case "c":
      return <FrontendMenu label="Choose your frontend" />;
    case "d":
      return fw ? (
        <StackRows variant={variant} framework={fw} slug={slug} />
      ) : null;
  }
}
