import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalDocsSlug,
  computeSearchablePages,
  readPageSourceWithSnippets,
} from "../searchable-pages";
import type { NavigationSurface } from "../searchable-pages";
import * as docsRender from "../docs-render";
import type { NavNode } from "../docs-render";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Write a throwaway content tree: `{ "<slug>": "<mdx source>" }`. */
function contentTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "searchable-pages-"));
  tempDirs.push(dir);
  for (const [slug, source] of Object.entries(files)) {
    const file = path.join(dir, `${slug}.mdx`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return dir;
}

function page(slug: string, title = slug): NavNode {
  return { type: "page", title, slug };
}

function surface(nodes: NavNode[], extra: Partial<NavigationSurface> = {}) {
  return [{ id: "test", nodes, ...extra }];
}

describe("searchable pages", () => {
  it("leaves out a page that no sidebar lists and nobody links to", () => {
    const contentDir = contentTree({
      quickstart: "# Quickstart\n",
      "whats-new": "# What's new\n",
    });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("quickstart")]),
    });

    expect(slugs.has("quickstart")).toBe(true);
    expect(slugs.has("whats-new")).toBe(false);
  });

  it("keeps a page that is absent from every sidebar but linked from prose", () => {
    const contentDir = contentTree({
      "intelligence/overview":
        "See [fully headless UI](/intelligence/headless-ui) for details.\n",
      "intelligence/headless-ui": "# Fully headless UI\n",
    });

    const { slugs, fromNavigation, fromLinks } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("intelligence/overview")]),
    });

    expect(fromNavigation.has("intelligence/headless-ui")).toBe(false);
    expect(fromLinks.has("intelligence/headless-ui")).toBe(true);
    expect(slugs.has("intelligence/headless-ui")).toBe(true);
  });

  it("counts links from the content a page inlines, not just its own file", () => {
    // Most CopilotKit pages are a frontmatter block and one component
    // reference; the prose that carries the links lives in the snippet.
    const contentDir = contentTree({
      "intelligence/overview": "<Overview components={props.components} />\n",
      "intelligence/headless-ui": "# Fully headless UI\n",
    });
    const surfaces = surface([page("intelligence/overview")]);

    // Reading only the page file sees no link at all.
    expect(
      computeSearchablePages({ contentDir, surfaces }).slugs.has(
        "intelligence/headless-ui",
      ),
    ).toBe(false);

    // Reading the page as the reader receives it does.
    const withSnippets = computeSearchablePages({
      contentDir,
      surfaces,
      readPageSource: (filePath, slug) =>
        slug === "intelligence/overview"
          ? "See [fully headless UI](/intelligence/headless-ui).\n"
          : fs.readFileSync(filePath, "utf-8"),
    });

    expect(withSnippets.fromLinks.has("intelligence/headless-ui")).toBe(true);
  });

  it("finds link targets in JSX hrefs as well as markdown links", () => {
    const contentDir = contentTree({
      index: '<a href="/deep-dive">Deep dive</a>\n',
      "deep-dive": "# Deep dive\n",
    });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("")]),
    });

    expect(slugs.has("deep-dive")).toBe(true);
  });

  it("does not follow links out of a page that is itself unreachable", () => {
    const contentDir = contentTree({
      quickstart: "# Quickstart\n",
      orphan: "Read [the leftover](/leftover).\n",
      leftover: "# Leftover\n",
    });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("quickstart")]),
    });

    expect(slugs.has("orphan")).toBe(false);
    expect(slugs.has("leftover")).toBe(false);
  });

  it("resolves a framework-scoped link onto the page it actually serves", () => {
    const contentDir = contentTree({
      quickstart: "See [emitting messages](/langgraph-python/advanced/emit).\n",
      "integrations/langgraph/advanced/emit": "# Emitting messages\n",
    });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("quickstart")], {
        id: "integration:langgraph-python",
        integrationFolder: "langgraph",
        routeScope: "langgraph-python",
      }),
    });

    expect(slugs.has("integrations/langgraph/advanced/emit")).toBe(true);
  });

  it("lets `search: false` force a listed page out of the index", () => {
    const contentDir = contentTree({
      quickstart: "---\ntitle: Quickstart\nsearch: false\n---\n",
    });

    const { slugs, fromNavigation, forcedOut } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("quickstart")]),
    });

    expect(fromNavigation.has("quickstart")).toBe(true);
    expect(forcedOut.has("quickstart")).toBe(true);
    expect(slugs.has("quickstart")).toBe(false);
  });

  it("lets `search: true` force an unreachable page into the index", () => {
    const contentDir = contentTree({
      quickstart: "# Quickstart\n",
      "intelligence/headless-ui":
        "---\ntitle: Fully Headless UI\nsearch: true\n---\n",
    });

    const { slugs, fromNavigation, forcedIn } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("quickstart")]),
    });

    expect(fromNavigation.has("intelligence/headless-ui")).toBe(false);
    expect(forcedIn.has("intelligence/headless-ui")).toBe(true);
    expect(slugs.has("intelligence/headless-ui")).toBe(true);
  });

  it("indexes no page for a navigation entry that points off-site", () => {
    const contentDir = contentTree({
      quickstart: "# Quickstart\n",
      "automatic-learning": "# Automatic learning\n",
    });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([
        page("quickstart"),
        {
          type: "page",
          title: "Automatic learning",
          slug: "automatic-learning",
          href: "https://copilotkit.ai/intelligence#learning",
        },
      ]),
    });

    expect(slugs.has("automatic-learning")).toBe(false);
  });

  it("keeps a folder page that the sidebar renders as an expandable group", () => {
    const contentDir = contentTree({
      "human-in-the-loop/index": "# Human in the loop\n",
      "human-in-the-loop/interrupt": "# Interrupts\n",
    });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([
        {
          type: "group",
          title: "Human-in-the-Loop",
          slug: "human-in-the-loop",
          children: [page("human-in-the-loop/interrupt")],
        },
      ]),
    });

    expect(slugs.has("human-in-the-loop")).toBe(true);
    expect(slugs.has("human-in-the-loop/interrupt")).toBe(true);
  });

  it("ignores the synthetic slug an inline sidebar folder uses as a React key", () => {
    const contentDir = contentTree({ threads: "# Threads\n" });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([
        {
          type: "group",
          title: "Rich threads",
          slug: "sidebar#rich-threads",
          children: [page("threads")],
        },
      ]),
    });

    expect([...slugs]).toEqual(["threads"]);
  });

  it("keeps integration pages under the folder form the search modal expects", () => {
    const contentDir = contentTree({
      "integrations/adk/quickstart": "# ADK quickstart\n",
    });

    // A framework sidebar rewrites `integrations/adk/quickstart` down to a
    // bare `quickstart`; the index generator still sees the folder form.
    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("quickstart")], {
        id: "integration:google-adk",
        integrationFolder: "adk",
        routeScope: "google-adk",
      }),
    });

    expect(slugs.has("integrations/adk/quickstart")).toBe(true);
  });

  it("does not invent a folder-form slug with no file behind it", () => {
    const contentDir = contentTree({ threads: "# Threads\n" });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("threads")], {
        id: "integration:google-adk",
        integrationFolder: "adk",
        routeScope: "google-adk",
      }),
    });

    expect(slugs.has("integrations/adk/threads")).toBe(false);
  });

  it("takes the union over surfaces rather than any single sidebar", () => {
    const contentDir = contentTree({
      threads: "# Threads\n",
      "integrations/mastra/guardrails": "# Guardrails\n",
    });

    const { slugs } = computeSearchablePages({
      contentDir,
      surfaces: [
        { id: "root", nodes: [page("threads")] },
        {
          id: "root-meta:integrations/mastra",
          nodes: [page("integrations/mastra/guardrails")],
        },
      ],
    });

    expect(slugs.has("threads")).toBe(true);
    expect(slugs.has("integrations/mastra/guardrails")).toBe(true);
  });

  it("names a page the way the sidebar names it", () => {
    const contentDir = contentTree({ threads: "---\ntitle: Threads\n---\n" });

    const { navTitles } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("threads", "Rich threads")]),
    });

    expect(navTitles.get("threads")).toBe("Rich threads");
  });

  it("ignores a sidebar title that only makes sense next to its parent", () => {
    const contentDir = contentTree({
      threads: "---\ntitle: Rich Threads\n---\n",
    });

    // `nav_title: Overview` reads fine under a "Rich Threads" group and
    // identifies nothing in a flat list of search results.
    const { navTitles } = computeSearchablePages({
      contentDir,
      surfaces: surface([page("threads", "Overview")]),
    });

    expect(navTitles.has("threads")).toBe(false);
  });
});

describe("canonicalDocsSlug", () => {
  it("strips the docs prefix, route groups and a trailing index", () => {
    expect(canonicalDocsSlug("/docs/(other)/telemetry")).toBe("telemetry");
    expect(canonicalDocsSlug("/docs/threads")).toBe("threads");
    expect(canonicalDocsSlug("docs")).toBe("");
    expect(canonicalDocsSlug("/docs")).toBe("");
    expect(canonicalDocsSlug("human-in-the-loop/index")).toBe(
      "human-in-the-loop",
    );
    expect(
      canonicalDocsSlug("/docs/integrations/agno/(other)/contributing"),
    ).toBe("integrations/agno/contributing");
  });

  it("does not mistake a slug segment that merely starts with docs", () => {
    expect(canonicalDocsSlug("/docs/docs-status")).toBe("docs-status");
  });
});

describe("snippet failure diagnostics", () => {
  it("reports the source and error, preserves raw links, and restores the logger", () => {
    const raw = "See [guide](/guide).";
    const dir = contentTree({ source: raw });
    const error = new Error("snippet read failed");
    vi.spyOn(docsRender, "inlineSnippets").mockImplementation(() => {
      throw error;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      readPageSourceWithSnippets(path.join(dir, "source.mdx"), "source"),
    ).toBe(raw);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"source"'),
      error,
    );
    expect(console.warn).toBe(warn);
  });
});
