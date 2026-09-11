import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { inlineSnippets, loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const shellDocsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const integrationsRoot = path.resolve(shellDocsRoot, "../integrations");

test("the canonical guide selects the Showcase-owned named renderer region", () => {
  const doc = loadDoc("generative-ui/tool-rendering");
  expect(doc).not.toBeNull();

  const rendered = inlineSnippets(doc!.source, "generative-ui/tool-rendering");

  expect(rendered).not.toContain("ToolRenderingPerToolExample");
  expect(rendered).toContain('region="render-weather-tool"');
});

test("the tool-rendering runtime frontend remains identical across integrations", () => {
  const page = (framework: string) =>
    fs.readFileSync(
      path.join(
        integrationsRoot,
        framework,
        "src/app/demos/tool-rendering/page.tsx",
      ),
      "utf8",
    );

  const googleAdk = page("google-adk");
  expect(page("langgraph-python")).toBe(googleAdk);
  expect(page("mastra")).toBe(googleAdk);
});

test("the shared default-rendering guidance uses the selected Showcase region", () => {
  const loadSlug = "integrations/langgraph/generative-ui/tool-rendering";
  const doc = loadDoc(loadSlug);
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "langgraph-python/generative-ui/tool-rendering",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug,
      framework: "langgraph-python",
    },
    { framework: "langgraph-python" },
  );

  expect(output).toContain("useDefaultRenderTool();");
  expect(output).not.toContain("JSON.stringify(result, null, 2)");
  expect(output).not.toContain("useRenderToolCall");
});
