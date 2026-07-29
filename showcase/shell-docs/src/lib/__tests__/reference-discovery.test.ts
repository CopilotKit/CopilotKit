import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type * as PageTree from "fumadocs-core/page-tree";

import { getAllLlmPages } from "../llm-text";
import {
  REFERENCE_VERSIONS,
  buildReferencePageTree,
  referenceStaticParams,
} from "../reference-items";

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

test("publishes the maintained Channels SDK reference in its original surface", () => {
  const staticReferenceSlugs = referenceStaticParams().map(({ slug }) =>
    slug.join("/"),
  );
  const referenceOverview = readFileSync(
    new URL("../../app/reference/page.tsx", import.meta.url),
    "utf8",
  );

  expect(REFERENCE_VERSIONS).toContain("channels");
  expect(staticReferenceSlugs).toEqual(
    expect.arrayContaining([
      "channels",
      "channels/classes/Channel",
      "channels/classes/Thread",
      "channels/types/JSXCallbacks",
    ]),
  );
  expect(referenceOverview).toContain('name: "Channels SDK"');
  expect(referenceOverview).toContain('href: referenceVersionHref("channels")');

  const navigationUrls = collectPageUrls(buildReferencePageTree("channels"));
  expect(navigationUrls).toEqual([
    "/reference/channels/classes/Channel",
    "/reference/channels/classes/Thread",
    "/reference/channels/types/JSXCallbacks",
  ]);
});
