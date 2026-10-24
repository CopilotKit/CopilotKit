import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { loadDoc } from "@/lib/docs-render";
import { docsComponents } from "@/lib/mdx-registry";

test("JSON Render guide opts into complete Code tabs across frameworks", () => {
  const doc = loadDoc("generative-ui/json-render");
  const inlineDemo = doc?.source.match(/<InlineDemo\b[\s\S]*?\/>/)?.[0];
  expect(inlineDemo).toMatch(/\bshowAllFiles\b/);

  const InlineDemo = docsComponents.InlineDemo;
  for (const integration of [
    "google-adk",
    "strands-typescript",
    "langgraph-python",
  ]) {
    const html = renderToStaticMarkup(
      <InlineDemo
        integration={integration}
        demo="declarative-json-render"
        showAllFiles={Boolean(inlineDemo?.includes("showAllFiles"))}
      />,
    );

    for (const filename of [
      "chat.tsx",
      "json-render-renderer.tsx",
      "catalog.ts",
      "registry.tsx",
    ]) {
      expect(html).toContain(
        `title="src/app/demos/declarative-json-render/${filename}"`,
      );
    }
  }

  const defaultHtml = renderToStaticMarkup(
    <InlineDemo
      integration="langgraph-python"
      demo="declarative-json-render"
    />,
  );
  expect(defaultHtml).not.toContain(
    'title="src/app/demos/declarative-json-render/chat.tsx"',
  );
});
