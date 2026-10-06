import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../registry", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDocsMode: () => "generated",
  };
});

import {
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  buildRootSurfaceNav,
  inlineSnippets,
  loadDoc,
  navAncestorBreadcrumbsForSlug,
  normalizeSidebarNav,
  readTitle,
  SNIPPET_MAP,
  SNIPPETS_DIR,
} from "../docs-render";
import type { NavNode } from "../docs-render";

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
  it("resolves clean URLs to files stored under route-group folders", () => {
    // llamaindex is an `authored` integration, so this file is served content
    // rather than a copy the root page shadows. The aws-strands equivalent
    // this used to assert on was deleted as a never-served duplicate.
    const doc = loadDoc("integrations/llamaindex/telemetry");

    expect(doc?.filePath.split(path.sep).join("/")).toContain(
      "integrations/llamaindex/(other)/telemetry/index.mdx",
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
    expect(loadDoc("threads")?.fm.title).toBe("AG-UI Streams");
  });
});

describe("framework nav", () => {
  it("derives breadcrumbs from the complete sidebar hierarchy", () => {
    const navTree = buildRootSurfaceNav("built-in-agent");

    expect(navAncestorBreadcrumbsForSlug(navTree, "frontend-tools")).toEqual([
      { label: "Basics", href: null },
    ]);
    expect(navAncestorBreadcrumbsForSlug(navTree, "threads")).toEqual([
      { label: "Intelligence", href: null },
      { label: "Features", href: null },
      { label: "AG-UI Streams", href: null },
    ]);
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
    const navTree = buildFrameworkNav(
      "langgraph",
      "LangGraph (Python)",
      "langgraph-python",
    );

    expect(hasSectionPage(navTree, "Platforms", "React Native")).toBe(false);
    expect(hasSectionPage(navTree, "Platforms", "Vue")).toBe(false);
  });

  it("keeps frontend platform guides out of authored framework nav", () => {
    const navTree = buildFrameworkOnlyNav("built-in-agent");

    expect(hasSectionPage(navTree, "Platforms", "React Native")).toBe(false);
    expect(hasSectionPage(navTree, "Platforms", "Slack")).toBe(false);
  });

  it("preserves new authored Threads pages through sidebar normalization", () => {
    const nav = structuredClone(buildRootSurfaceNav("built-in-agent"));
    const threads = nav.find(
      (node) => node.type === "group" && node.title === "Threads",
    );
    if (!threads || threads.type !== "group")
      throw new Error("Missing Threads group");
    threads.children.push({
      type: "page",
      title: "Custom thread UI",
      slug: "custom-thread-ui",
    });
    const normalized = normalizeSidebarNav(nav);
    expect(groupPageEntries(normalized, "Threads")).toContainEqual({
      title: "Custom thread UI",
      slug: "custom-thread-ui",
    });
    expect(
      navAncestorBreadcrumbsForSlug(normalized, "custom-thread-ui")?.map(
        ({ label }) => label,
      ),
    ).toEqual(["Basics", "Threads"]);
  });
});
