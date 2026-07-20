import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../registry", () => ({
  getDocsMode: () => "generated",
}));

import {
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  CONTENT_DIR,
  inlineSnippets,
  loadDoc,
  readIcon,
  readTitle,
  SNIPPET_MAP,
  SNIPPETS_DIR,
} from "../docs-render";
import type { NavNode } from "../docs-render";
import { buildCookbookNavTree } from "../cookbook-nav";
import { navTreeToPageTree } from "../page-tree-bridge";
import { buildReferencePageTree } from "../reference-items";

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

function groupPageTitles(navTree: NavNode[], groupTitle: string): string[] {
  for (const node of navTree) {
    if (node.type !== "group") continue;
    if (node.title === groupTitle) {
      return node.children.flatMap((child) =>
        child.type === "page" ? [child.title] : [],
      );
    }

    const nested = groupPageTitles(node.children, groupTitle);
    if (nested.length > 0) return nested;
  }

  return [];
}

function sectionPages(navTree: NavNode[], section: string): string[] {
  const pages: string[] = [];
  let inSection = false;
  for (const node of navTree) {
    if (node.type === "section") {
      inSection = node.title === section;
      continue;
    }
    if (!inSection) continue;
    if (node.type === "page") pages.push(node.title);
  }
  return pages;
}

function collectMdxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectMdxFiles(filePath);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [filePath] : [];
  });
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
    const doc = loadDoc("integrations/aws-strands/telemetry");

    expect(doc?.filePath).toContain(
      "integrations/aws-strands/(other)/telemetry/index.mdx",
    );
  });

  it("keeps the Threads overview and headless implementation on separate routes", () => {
    expect(loadDoc("threads")?.fm.title).toBe("Threads");
    expect(loadDoc("headless-threads")?.fm.title).toBe("Headless Threads");
    expect(loadDoc("integrations/mastra/threads")?.fm.title).toBe("Threads");
    expect(loadDoc("integrations/mastra/headless-threads")?.fm.title).toBe(
      "Headless Threads",
    );
  });
});

describe("readIcon", () => {
  it("only exposes page icons when frontmatter opts in with showIcon", () => {
    const hiddenIconFile = path.join(tempDir, "hidden-icon.mdx");
    const visibleIconFile = path.join(tempDir, "visible-icon.mdx");

    fs.writeFileSync(
      hiddenIconFile,
      [
        "---",
        'title: "Hidden icon"',
        'icon: "lucide/Bolt"',
        "---",
        "",
        "Body",
      ].join("\n"),
    );
    fs.writeFileSync(
      visibleIconFile,
      [
        "---",
        'title: "Visible icon"',
        'icon: "lucide/Bolt"',
        "showIcon: true",
        "---",
        "",
        "Body",
      ].join("\n"),
    );

    expect(readIcon(hiddenIconFile)).toBeNull();
    expect(readIcon(visibleIconFile)).toBe("lucide/Bolt");
  });
});

describe("readTitle", () => {
  it("uses nav_title for navigation without changing the page title", () => {
    const filePath = path.join(tempDir, "nav-title.mdx");
    fs.writeFileSync(
      filePath,
      [
        "---",
        'title: "Threads"',
        'nav_title: "Overview"',
        "---",
        "",
        "Body",
      ].join("\n"),
    );

    expect(readTitle(filePath)).toBe("Overview");
    expect(loadDoc("threads")?.fm.title).toBe("Threads");
  });
});

describe("reference nav", () => {
  it("renders the Reference root entry with a book icon", () => {
    const tree = buildReferencePageTree("v2");
    const markup = renderToStaticMarkup(
      React.createElement(React.Fragment, null, tree.name),
    );

    expect(markup).toContain("lucide-book-open");
    expect(markup).toContain("Reference");
  });
});

describe("migration docs", () => {
  it("recommends CopilotKit from the v2 entrypoint instead of CopilotKitProvider", () => {
    const snippet = fs.readFileSync(
      path.join(SNIPPETS_DIR, "shared/troubleshooting/migrate-to-v2.mdx"),
      "utf8",
    );

    expect(snippet).toContain(
      "Keep the `<CopilotKit>` provider name, but import it from `@copilotkit/react-core/v2`.",
    );
    expect(snippet).toContain(
      'import { CopilotKit, useAgent } from "@copilotkit/react-core/v2";',
    );
    expect(snippet).toContain(
      'import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";',
    );
    expect(snippet).not.toContain("CopilotKitProvider");
  });

  it("keeps v2 reference pages aligned with the CopilotKit v2 entrypoint", () => {
    const referenceIndex = fs.readFileSync(
      path.join(CONTENT_DIR, "..", "reference/index.mdx"),
      "utf8",
    );
    const componentReference = fs.readFileSync(
      path.join(CONTENT_DIR, "..", "reference/components/CopilotKit.mdx"),
      "utf8",
    );

    expect(referenceIndex).toContain(
      'import { CopilotKit } from "@copilotkit/react-core/v2";',
    );
    expect(referenceIndex).not.toContain(
      "CopilotKit is imported from the root package",
    );
    expect(referenceIndex).not.toContain(
      "import `CopilotKit` from `@copilotkit/react-core`",
    );
    expect(componentReference).toContain("`@copilotkit/react-core/v2`");
    expect(componentReference).not.toContain("not from the v2 subpackage");
  });

  it("does not recommend stale v2 package paths in authored docs", () => {
    const authoredDocFiles = collectMdxFiles(CONTENT_DIR);
    const allowedRootProviderImports = new Set([
      path.join(CONTENT_DIR, "migrate/v2.mdx"),
    ]);

    const rootProviderImports = authoredDocFiles.filter((filePath) => {
      if (allowedRootProviderImports.has(filePath)) return false;
      return fs
        .readFileSync(filePath, "utf8")
        .includes('import { CopilotKit } from "@copilotkit/react-core";');
    });

    const oldV2StyleImports = [
      ...authoredDocFiles,
      ...collectMdxFiles(SNIPPETS_DIR),
    ].filter((filePath) =>
      fs
        .readFileSync(filePath, "utf8")
        .includes("@copilotkit/react-ui/v2/styles.css"),
    );

    expect(rootProviderImports).toEqual([]);
    expect(oldV2StyleImports).toEqual([]);
  });
});

describe("cookbook nav", () => {
  it("renders overview and recipes as top-level entries without changing slugs", () => {
    const navTree = buildCookbookNavTree();

    expect(navTree).toHaveLength(6);
    expect(navTree.map((node) => node.type)).toEqual([
      "page",
      "page",
      "page",
      "page",
      "page",
      "page",
    ]);
    expect(
      navTree.map((node) =>
        node.type === "page" ? [node.title, node.slug] : null,
      ),
    ).toEqual([
      ["Overview", "cookbook/index"],
      ["Daytona", "cookbook/daytona"],
      ["Oracle Agent Memory", "cookbook/oracle-agent-spec-memory"],
      ["Arcade", "cookbook/arcade"],
      ["Angular + Google ADK", "cookbook/angular-adk-agentic-app"],
      ["OpenBox Governance", "cookbook/openbox-governed-copilotkit"],
    ]);

    const pageTree = navTreeToPageTree(navTree, "");
    expect(pageTree.children.map((node) => node.type)).toEqual([
      "page",
      "page",
      "page",
      "page",
      "page",
      "page",
    ]);
    expect(
      pageTree.children.map((node) => (node.type === "page" ? node.url : null)),
    ).toEqual([
      "/cookbook",
      "/cookbook/daytona",
      "/cookbook/oracle-agent-spec-memory",
      "/cookbook/arcade",
      "/cookbook/angular-adk-agentic-app",
      "/cookbook/openbox-governed-copilotkit",
    ]);

    const overview = pageTree.children[0];
    if (overview?.type !== "page") throw new Error("expected Overview page");
    const overviewMarkup = renderToStaticMarkup(
      React.createElement(React.Fragment, null, overview.name),
    );
    expect(overviewMarkup).toContain("lucide-book-open");
    expect(overviewMarkup).toContain("Overview");
  });
});

describe("framework nav", () => {
  it("leaves Slack and Teams platform guides ungated", () => {
    const slack = loadDoc("frontends/slack")?.fm;
    const teams = loadDoc("frontends/teams")?.fm;

    expect(slack?.earlyAccess).toBeUndefined();
    expect(slack?.hideTOC).toBe(true);
    expect(teams?.earlyAccess).toBeUndefined();
    expect(teams?.hideTOC).toBe(true);
  });

  it("loads early-access frontmatter for gated platform guides", () => {
    const whatsapp = loadDoc("frontends/whatsapp")?.fm;

    expect(whatsapp?.earlyAccess).toBe("whatsapp");
    expect(whatsapp?.hideTOC).toBe(true);
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

  it("shows the CLI page in generated and authored framework nav", () => {
    const generatedNav = buildFrameworkNav(
      "langgraph",
      "LangGraph (Python)",
      "langgraph-python",
    );
    const authoredNav = buildFrameworkOnlyNav("mastra");
    const sharedFolderAuthoredNav = buildFrameworkOnlyNav("langgraph");

    expect(hasPageTitle(generatedNav, "CopilotKit CLI")).toBe(true);
    expect(hasPageTitle(authoredNav, "CopilotKit CLI")).toBe(true);
    expect(hasPageTitle(sharedFolderAuthoredNav, "CopilotKit CLI")).toBe(true);
  });

  it("orders the Threads job routes consistently across framework modes", () => {
    const generatedNav = buildFrameworkNav(
      "langgraph",
      "LangGraph (Python)",
      "langgraph-python",
    );
    const authoredNav = buildFrameworkOnlyNav("mastra");
    const builtInNav = buildFrameworkOnlyNav("built-in-agent");

    const expected = [
      "Overview",
      "Threads Drawer",
      "Headless Threads",
      "Threads & Persistence Architecture",
      "Import Thread History",
    ];

    expect(groupPageTitles(generatedNav, "Threads")).toEqual(expected);
    expect(groupPageTitles(authoredNav, "Threads")).toEqual(expected);
    expect(groupPageTitles(builtInNav, "Threads")).toEqual(expected);
  });

  it("uses the generated Intelligence Platform section for authored framework nav", () => {
    const navTree = buildFrameworkOnlyNav("ag2");

    expect(navTree.some((node) => node.title === "Premium Features")).toBe(
      false,
    );
    expect(navTree.some((node) => node.title === "Enterprise")).toBe(false);
    expect(hasSectionPage(navTree, "Basics", "Headless Threads")).toBe(true);
    expect(sectionPages(navTree, "Intelligence Platform")).toEqual([
      "Enterprise Intelligence Platform",
      "Cloud-Hosted Enterprise Intelligence",
      "Self-Hosting Enterprise Intelligence",
      "Enterprise Intelligence Architecture",
    ]);
  });
});
