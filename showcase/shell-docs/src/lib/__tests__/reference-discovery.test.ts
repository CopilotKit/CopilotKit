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

test("publishes the Vue thread reference pages in navigation and LLM output", () => {
  const navigationUrls = collectPageUrls(buildReferencePageTree("vue"));
  const llmUrls = getAllLlmPages().map((page) => page.url);

  expect(navigationUrls).toEqual(
    expect.arrayContaining([
      "/reference/vue/hooks/useThreads",
      "/reference/vue/components/CopilotThreadsDrawer",
    ]),
  );
  expect(llmUrls).toEqual(
    expect.arrayContaining([
      "reference/vue/hooks/useThreads",
      "reference/vue/components/CopilotThreadsDrawer",
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
      "channels/components/Button",
      "channels/components/Chart",
      "channels/functions/createChannel",
      "channels/functions/defineChannelTool",
      "channels/sdk/direct-adapters",
      "channels/types/JSXCallbacks",
      "channels/types/StateStore",
    ]),
  );
  expect(referenceOverview).toContain('name: "Channels SDK"');
  expect(referenceOverview).toContain('href: referenceVersionHref("channels")');

  const navigationUrls = collectPageUrls(buildReferencePageTree("channels"));
  expect(navigationUrls).toHaveLength(34);
  expect(navigationUrls).toEqual(
    expect.arrayContaining([
      "/reference/channels/classes/Channel",
      "/reference/channels/classes/MemoryStore",
      "/reference/channels/classes/Thread",
      "/reference/channels/classes/Transcripts",
      "/reference/channels/components/Message",
      "/reference/channels/components/Button",
      "/reference/channels/components/Chart",
      "/reference/channels/components/Modal",
      "/reference/channels/functions/createChannel",
      "/reference/channels/functions/defineChannelCommand",
      "/reference/channels/functions/defineChannelTool",
      "/reference/channels/sdk/direct-adapters",
      "/reference/channels/types/ActionStore",
      "/reference/channels/types/AgentContentPart",
      "/reference/channels/types/JSXCallbacks",
      "/reference/channels/types/StateStore",
    ]),
  );
});
