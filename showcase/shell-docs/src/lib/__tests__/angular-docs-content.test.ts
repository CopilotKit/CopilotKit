import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  getAngularDocsNavTree,
  resolveAngularDoc,
} from "../angular-doc-navigation";
import { loadDoc } from "../docs-render";
import type { NavNode } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { getIntegrations } from "../registry";

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

function expectAngularSurfaceToBeNative(
  backendFramework: string | null,
  slugs: string[],
): void {
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

    expect(output, pageLabel).not.toMatch(
      /@copilotkit\/react|from ["']react["']|\buse(?:Agent|Copilot\w*)\s*\(|<Copilot(?:Kit|Chat|Sidebar|Popup)\b(?=[^>]*(?:runtimeUrl|publicApiKey|enableInspector|renderActivityMessages|onError))[^>]*>|<FrontendOnly|<AngularSnippet/,
    );
  }
}

test("keeps the complete Angular surface free of another frontend's code", () => {
  const slugs = pageSlugs(getAngularDocsNavTree(null)).filter(Boolean);
  expect(slugs.length).toBeGreaterThanOrEqual(33);
  expectAngularSurfaceToBeNative(null, slugs);
});

test("keeps every Angular and backend combination frontend-native", () => {
  for (const integration of getIntegrations()) {
    if (integration.docs_mode === "hidden") continue;
    const slugs = pageSlugs(getAngularDocsNavTree(integration.slug)).filter(
      (slug) => slug !== "" && slug !== "quickstart",
    );
    expectAngularSurfaceToBeNative(integration.slug, slugs);
  }
});
