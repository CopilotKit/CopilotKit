import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Before lib/docs-searchable: it reads shell-docs relative to the cwd.
import "./shell-docs-cwd";
import fs from "fs";
import path from "path";

vi.mock("../../lib/docs-searchable/registry", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDocsMode: () => "generated",
  };
});

import {
  buildFrameworkNav,
  CONTENT_DIR,
  inlineSnippets,
  loadDoc,
  navAncestorBreadcrumbsForSlug,
  readMeta,
  readTitle,
  SNIPPET_MAP,
  SNIPPETS_DIR,
} from "../../lib/docs-searchable/docs-render";
import type { MetaPageEntry } from "../../lib/docs-searchable/docs-render";
import type { NavNode } from "../../lib/docs-searchable/docs-render";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(SNIPPETS_DIR, "__pdx-208-"));
});

afterEach(() => {
  delete SNIPPET_MAP.Pdx208Parent;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  vi.restoreAllMocks();
});

function writeSnippet(filename: string, body: string): string {
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, body);
  return path.relative(SNIPPETS_DIR, filePath);
}

function hasSectionPage(navTree: NavNode[], section: string, page: string) {
  let inSection = false;
  for (const node of navTree) {
    if (node.type === "section") {
      inSection = node.title === section;
      continue;
    }
    if (inSection && node.type === "page" && node.title === page) return true;
    if (
      inSection &&
      node.type === "group" &&
      hasPageTitle(node.children, page)
    ) {
      return true;
    }
  }
  return false;
}

function hasPageTitle(navTree: NavNode[], page: string): boolean {
  return navTree.some((node) => {
    if (node.type === "page") return node.title === page;
    if (node.type === "group") return hasPageTitle(node.children, page);
    return false;
  });
}

type NavPageEntry = { title: string; slug: string };

/** The rows under a sidebar section heading, up to the next one. */
function sectionNodes(navTree: NavNode[], section: string): NavNode[] {
  const start = navTree.findIndex(
    (node) => node.type === "section" && node.title === section,
  );
  if (start === -1) return [];
  const end = navTree.findIndex(
    (node, i) => i > start && node.type === "section",
  );
  return navTree.slice(start + 1, end === -1 ? undefined : end);
}

function groupPageEntries(
  navTree: NavNode[],
  groupTitle: string,
): NavPageEntry[] {
  for (const node of navTree) {
    if (node.type !== "group") continue;
    if (node.title === groupTitle) {
      if (node.children.some((child) => child.type !== "page")) {
        throw new Error(`${groupTitle} must contain only direct page entries`);
      }
      return node.children.map((child) => {
        if (child.type !== "page") throw new Error("expected page entry");
        return { title: child.title, slug: child.slug };
      });
    }

    const nested = groupPageEntries(node.children, groupTitle);
    if (nested.length > 0) return nested;
  }

  return [];
}

describe("inlineSnippets", () => {
  it("recursively inlines helper components imported from snippets", () => {
    const helperRel = writeSnippet("helper.mdx", "Helper body\n");
    const parentRel = writeSnippet(
      "parent.mdx",
      [
        `import Pdx208Helper from "@/snippets/${helperRel}";`,
        "",
        "Before",
        "<Pdx208Helper />",
        "After",
      ].join("\n"),
    );
    SNIPPET_MAP.Pdx208Parent = parentRel;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rendered = inlineSnippets("<Pdx208Parent />", "pdx-208");

    expect(rendered).toContain("Before");
    expect(rendered).toContain("Helper body");
    expect(rendered).toContain("After");
    expect(rendered).not.toContain("<Pdx208Helper />");
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[docs-render] snippet missing for component",
      "Pdx208Helper",
      "from slug",
      "pdx-208",
    );
  });

  it("preserves non-snippet component imports as runtime components", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rendered = inlineSnippets(
      [
        'import RuntimeCard from "@/components/runtime-card";',
        "",
        "<RuntimeCard />",
      ].join("\n"),
      "pdx-208-runtime",
    );

    expect(rendered).toContain("<RuntimeCard />");
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[docs-render] snippet missing for component",
      "RuntimeCard",
      "from slug",
      "pdx-208-runtime",
    );
  });

  it("preserves multiline runtime component imports", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rendered = inlineSnippets(
      [
        "import {",
        "  RuntimeCard,",
        '} from "@/components/runtime-card";',
        "",
        "<RuntimeCard />",
      ].join("\n"),
      "pdx-208-runtime-multiline",
    );

    expect(rendered).toContain("<RuntimeCard />");
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[docs-render] snippet missing for component",
      "RuntimeCard",
      "from slug",
      "pdx-208-runtime-multiline",
    );
  });
});

describe("loadDoc", () => {
  it("resolves the AG-UI Streams overview at its canonical root", () => {
    // The per-framework copies were folded into this root page.
    expect(loadDoc("AG-UI-Streams")?.fm.title).toBe("AG-UI Streams");
    expect(loadDoc("integrations/mastra/AG-UI-Streams")).toBeNull();
    expect(loadDoc("threads")).toBeNull();
  });

  it("resolves clean URLs to files stored under route-group folders", () => {
    // The per-framework `(other)` copies this used to assert on were folded
    // into the shared pages; the root `(other)` group still holds this one.
    const doc = loadDoc("contributing/code-contributions");

    expect(doc?.filePath.split(path.sep).join("/")).toContain(
      "(other)/contributing/code-contributions/index.mdx",
    );
  });
});

describe("readTitle", () => {
  it("uses nav_title for navigation without changing the page title", () => {
    const filePath = path.join(tempDir, "nav-title.mdx");
    fs.writeFileSync(
      filePath,
      [
        "---",
        'title: "AG-UI Streams"',
        'nav_title: "Overview"',
        "---",
        "",
        "Body",
      ].join("\n"),
    );

    expect(readTitle(filePath)).toBe("Overview");
    expect(loadDoc("AG-UI-Streams")?.fm.title).toBe("AG-UI Streams");
  });
});

describe("framework nav", () => {
  it("derives breadcrumbs from the complete sidebar hierarchy", () => {
    const navTree = buildFrameworkNav("built-in-agent");

    expect(navAncestorBreadcrumbsForSlug(navTree, "frontend-tools")).toEqual([
      { label: "Basics", href: null },
    ]);
    expect(navAncestorBreadcrumbsForSlug(navTree, "AG-UI-Streams")).toEqual([
      { label: "Intelligence", href: null },
      { label: "Features", href: null },
      { label: "AG-UI Streams", href: null },
    ]);
    // Prebuilt Components is one row in Chat now (a link entry in
    // docs/meta.json), not a folder of its own pages.
    expect(
      navAncestorBreadcrumbsForSlug(navTree, "prebuilt-components"),
    ).toEqual([
      { label: "Basics", href: null },
      { label: "Chat", href: null },
    ]);
    expect(
      navAncestorBreadcrumbsForSlug(navTree, "custom-look-and-feel/slots"),
    ).toEqual([
      { label: "Basics", href: null },
      { label: "Chat", href: null },
      { label: "Custom Look and Feel", href: null },
    ]);
  });

  it("does not publish a selectable WhatsApp guide before launch", () => {
    expect(loadDoc("frontends/whatsapp")).toBeNull();
  });

  it("keeps frontend platform guides out of generated framework nav", () => {
    const navTree = buildFrameworkNav("langgraph", "LangGraph (Python)");

    expect(hasSectionPage(navTree, "Platforms", "React Native")).toBe(false);
    expect(hasSectionPage(navTree, "Platforms", "Vue")).toBe(false);
  });

  it("keeps frontend platform guides out of the built-in agent's nav", () => {
    const navTree = buildFrameworkNav("built-in-agent");

    expect(hasSectionPage(navTree, "Platforms", "React Native")).toBe(false);
    expect(hasSectionPage(navTree, "Platforms", "Slack")).toBe(false);
  });

  // The sidebar is docs/meta.json as authored; nothing regroups it any more,
  // so this checks the authored Threads pages all land, in order.
  it("keeps every authored Threads page in the sidebar", () => {
    const threadsMeta = readMeta(CONTENT_DIR)?.pages?.find(
      (entry): entry is Exclude<MetaPageEntry, string> =>
        typeof entry === "object" && entry.title === "Threads",
    );
    if (!threadsMeta) throw new Error("Missing Threads group in meta.json");
    const nav = buildFrameworkNav("built-in-agent");

    expect(groupPageEntries(nav, "Threads").map(({ slug }) => slug)).toEqual(
      threadsMeta.pages,
    );
    for (const slug of threadsMeta.pages as string[]) {
      expect(
        navAncestorBreadcrumbsForSlug(nav, slug)?.map(({ label }) => label),
      ).toEqual(["Basics", "Threads"]);
    }
  });
});

it("keeps the existing-thread guide discoverable in root and framework sidebars", () => {
  const expected = {
    title: "Bring your own thread system",
    slug: "intelligence/bring-your-own-thread-system",
  };
  for (const nav of [
    buildFrameworkNav("built-in-agent"),
    buildFrameworkNav("langgraph", "LangGraph (Python)"),
    buildFrameworkNav("ag2", "AG2"),
  ]) {
    // A framework's own pages can carry an "AG-UI Streams" group too
    // (LangGraph's import guide), so look in the shared Intelligence section.
    expect(
      groupPageEntries(sectionNodes(nav, "Intelligence"), "AG-UI Streams"),
    ).toContainEqual(expected);
  }
});

it("lists the Trajectories overview among the other Intelligence features", () => {
  const expectedSlugs = [
    "intelligence/trajectories",
    "intelligence/trajectories-quickstart",
    "intelligence/capture-interactions",
    "intelligence/captured-data",
    "intelligence/trajectories-reference",
  ];
  for (const slug of expectedSlugs) {
    expect(loadDoc(slug)?.fm.earlyAccess, slug).toBe("trajectories");
  }
  for (const nav of [
    buildFrameworkNav("built-in-agent"),
    buildFrameworkNav("langgraph", "LangGraph (Python)"),
    buildFrameworkNav("ag2", "AG2"),
  ]) {
    const features = (slug: string) =>
      navAncestorBreadcrumbsForSlug(nav, slug)?.map(({ label }) => label);
    // docs/(shared)/meta.json lists the Trajectories overview and Automatic
    // Learning as single Features rows; the other Trajectories guides and
    // Skill delivery left the sidebar and are linked from those pages.
    expect(features("intelligence/trajectories")).toEqual([
      "Intelligence",
      "Features",
    ]);
    expect(features("learning")).toEqual(["Intelligence", "Features"]);
    for (const slug of expectedSlugs.slice(1)) {
      expect(navAncestorBreadcrumbsForSlug(nav, slug), slug).toBeNull();
    }
    expect(hasSectionPage(nav, "Intelligence", "User Memories")).toBe(true);
    // Angular capture routes to the standalone collector, so it stays in the
    // Intelligence nav.
    expect(hasSectionPage(nav, "Intelligence", "Standalone collector")).toBe(
      true,
    );
  }
});
