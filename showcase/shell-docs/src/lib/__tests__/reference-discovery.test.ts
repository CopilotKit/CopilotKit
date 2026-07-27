import { expect, test } from "vitest";
import type * as PageTree from "fumadocs-core/page-tree";

import { getAllLlmPages } from "../llm-text";
import { buildReferencePageTree } from "../reference-items";

function collectPageUrls(tree: PageTree.Root): string[] {
  const urls: string[] = [];

  function visit(nodes: PageTree.Node[]): void {
    for (const node of nodes) {
      if (node.type === "page") urls.push(node.url);
      if (node.type === "folder") {
        if (node.index) urls.push(node.index.url);
        visit(node.children);
      }
    }
  }

  visit(tree.children);
  return urls;
}

test("publishes Angular reference guides in navigation and LLM output", () => {
  const navigationUrls = collectPageUrls(buildReferencePageTree("angular"));
  const llmUrls = getAllLlmPages().map((page) => page.url);

  expect(navigationUrls).toEqual(
    expect.arrayContaining([
      "/reference/angular/public-api",
      "/reference/angular/production-lifecycle",
    ]),
  );
  expect(llmUrls).toEqual(
    expect.arrayContaining([
      "reference/angular/public-api",
      "reference/angular/production-lifecycle",
    ]),
  );
});
