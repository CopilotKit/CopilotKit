import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  getAngularDocsNavTree,
  resolveAngularDoc,
} from "../angular-doc-navigation";
import {
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  buildRootSurfaceNav,
  loadDoc,
} from "../docs-render";
import type { NavNode } from "../docs-render";
import { getFrontendCanonicalSlug } from "../frontend-page-content";
import { renderPageToLlmText } from "../llm-text";
import {
  getDocsFolder,
  getDocsMode,
  getIntegration,
  getIntegrations,
  ROOT_FRAMEWORK,
} from "../registry";

function markdownFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.name.endsWith(".mdx") ? [entryPath] : [];
  });
}

test("keeps published Angular docs standalone and canonical", () => {
  const contentRoot = join(process.cwd(), "src/content");
  const paths = [
    join(contentRoot, "docs/frontends/angular.mdx"),
    join(contentRoot, "docs/cookbook/angular-adk-agentic-app.mdx"),
    ...markdownFiles(join(contentRoot, "docs/frontends/angular")),
    ...markdownFiles(join(contentRoot, "reference/angular")),
  ];
  const publishedCopy = paths
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  expect(publishedCopy).not.toMatch(/\bReact\b/);
  expect(publishedCopy).not.toContain("/frontends/angular");
});

function pageSlugs(nodes: NavNode[]): string[] {
  return nodes.flatMap((node): string[] => {
    if (node.type === "page") return node.href ? [] : [node.slug];
    if (node.type === "group") return pageSlugs(node.children);
    return [];
  });
}

function getReactNavTree(backendFramework: string | null): NavNode[] {
  if (!backendFramework) {
    return buildRootSurfaceNav(getDocsFolder(ROOT_FRAMEWORK));
  }

  const folder = getDocsFolder(backendFramework);
  if (getDocsMode(backendFramework) === "authored") {
    return buildFrameworkOnlyNav(folder);
  }

  return buildFrameworkNav(
    folder,
    getIntegration(backendFramework)?.name ?? backendFramework,
    backendFramework,
  );
}

function getCanonicalAngularSlug(
  backendFramework: string | null,
  reactSlug: string,
): string {
  if (!backendFramework && reactSlug === "quickstart") return "";
  return getFrontendCanonicalSlug("angular", reactSlug);
}

const REACT_ONLY_CONTENT =
  /@copilotkit\/react|from ["']react["']|\bReact components?\b|`use(?:Agent|Copilot\w*|RenderTool|FrontendTool|HumanInTheLoop|Component)`|\buse(?:Agent|Copilot\w*|RenderTool|FrontendTool|HumanInTheLoop|Component)\s*\(|<Copilot(?:Kit|Chat|Sidebar|Popup)\b(?=[^>]*(?:runtimeUrl|publicApiKey|enableInspector|renderActivityMessages|onError))[^>]*>|<FrontendOnly|<AngularSnippet/g;

function findReactOnlyAngularContent(
  backendFramework: string | null,
  slugs: string[],
): string[] {
  const leaks: string[] = [];

  for (const slug of slugs) {
    const pageLabel = backendFramework ? `${backendFramework}/${slug}` : slug;
    const resolution = resolveAngularDoc(backendFramework, slug);
    expect(resolution, pageLabel).not.toBeNull();
    const doc = loadDoc(resolution!.contentSlugPath);
    expect(doc, pageLabel).not.toBeNull();

    if (slug === "features") continue;
    const output = renderPageToLlmText(
      {
        url: `angular/${backendFramework ? `${backendFramework}/` : ""}${slug}`,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
        loadSlug: resolution!.contentSlugPath,
        framework: resolution!.framework,
      },
      { framework: resolution!.framework, frontend: "angular" },
    );

    const match = output.match(REACT_ONLY_CONTENT);
    if (match) {
      leaks.push(`${pageLabel}: ${[...new Set(match)].join(", ")}`);
    }
  }

  return leaks;
}

test("maps every React navigation destination to a published Angular destination", () => {
  const backends = [
    null,
    ...getIntegrations()
      .filter((integration) => integration.docs_mode !== "hidden")
      .map((integration) => integration.slug),
  ];

  for (const backendFramework of backends) {
    const angularSlugs = new Set(
      pageSlugs(getAngularDocsNavTree(backendFramework)),
    );

    for (const reactSlug of pageSlugs(getReactNavTree(backendFramework))) {
      const angularSlug = getCanonicalAngularSlug(backendFramework, reactSlug);
      expect(
        angularSlugs.has(angularSlug),
        `${backendFramework ?? "root"}: ${reactSlug} -> ${angularSlug}`,
      ).toBe(true);
    }
  }
});

test("keeps the complete Angular surface free of another frontend's code", () => {
  const slugs = pageSlugs(getAngularDocsNavTree(null)).filter(Boolean);
  expect(findReactOnlyAngularContent(null, slugs)).toEqual([]);
});

test("keeps every Angular and backend combination frontend-native", () => {
  const leaks: string[] = [];

  for (const integration of getIntegrations()) {
    if (integration.docs_mode === "hidden") continue;
    const slugs = pageSlugs(getAngularDocsNavTree(integration.slug)).filter(
      (slug) => slug !== "" && slug !== "quickstart",
    );
    leaks.push(...findReactOnlyAngularContent(integration.slug, slugs));
  }

  expect(leaks).toEqual([]);
});
