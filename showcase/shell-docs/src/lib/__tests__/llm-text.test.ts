import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes canonical Angular URLs instead of source-tree URLs", () => {
  const urls = getAllLlmPages().map((page) => page.url);

  expect(urls).toEqual(
    expect.arrayContaining([
      "angular",
      "angular/features",
      "angular/guides/chat-ui",
      "angular/guides/frontend-tools-generative-ui",
      "angular/guides/human-in-the-loop",
      "angular/guides/shared-state",
      "angular/guides/threads-memory-attachments-headless",
      "angular/using-these-docs",
    ]),
  );
  expect(urls.some((url) => url.startsWith("frontends/angular"))).toBe(false);
});

test("expands VueDocExample tags from canonical bundled source", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vue-doc-llm-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "page.mdx");
  fs.writeFileSync(
    filePath,
    [
      "---",
      "title: Vue example",
      "---",
      '<VueDocExample file="quickstart/App.vue" region="provider-chat-app" />',
    ].join("\n"),
  );

  const output = renderPageToLlmText({
    url: "fixture",
    title: "Vue example",
    filePath,
    loadSlug: "__reference__/fixture",
  });

  expect(output).toContain("```vue");
  expect(output).toContain("<!-- quickstart/App.vue -->");
  expect(output).toContain("<CopilotKitProvider");
  expect(output).not.toContain("<VueDocExample");
});

test("emits a stable diagnostic for invalid VueDocExample attributes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vue-doc-llm-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "page.mdx");
  fs.writeFileSync(filePath, '<VueDocExample region="missing" />');

  const output = renderPageToLlmText({
    url: "fixture",
    title: "Vue example",
    filePath,
    loadSlug: "__reference__/fixture",
  });

  expect(output).toContain(
    '[VueDocExample error: missing required "file" attribute]',
  );
});

test("rejects non-literal VueDocExample attributes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vue-doc-llm-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "page.mdx");
  fs.writeFileSync(
    filePath,
    '<VueDocExample file="quickstart/App.vue" region={dynamicRegion} />',
  );

  const output = renderPageToLlmText({
    url: "fixture",
    title: "Vue example",
    filePath,
    loadSlug: "__reference__/fixture",
  });

  expect(output).toContain(
    '[VueDocExample error: "region" must be a quoted string]',
  );
});
