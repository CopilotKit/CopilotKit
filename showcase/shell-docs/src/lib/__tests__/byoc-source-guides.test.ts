import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const selectedFrameworks = [
  "langgraph-python",
  "langgraph-typescript",
  "google-adk",
  "strands",
  "built-in-agent",
];

function renderGuide(loadSlug: string, framework: string): string {
  const doc = loadDoc(loadSlug);
  if (!doc) throw new Error(`missing ${loadSlug}`);
  return renderPageToLlmText(
    {
      url: `${framework}/${loadSlug}`,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug,
      framework,
    },
    { framework },
  );
}

test("the Hashbrown guide resolves the selected Showcase kit and parser", () => {
  const source = loadDoc("generative-ui/hashbrown")?.source ?? "";
  expect(source).toContain('cell="declarative-hashbrown"');
  expect(source).toContain(
    'file="src/app/demos/declarative-hashbrown/hashbrown-renderer.tsx"',
  );
  expect(source).not.toContain("HashBrownAssistantMessage");
  expect(source).not.toContain("useUiKit({ catalog, value: parsed })");

  for (const framework of selectedFrameworks) {
    const output = renderGuide("generative-ui/hashbrown", framework);
    expect(output, framework).toContain("useUiKit({");
    expect(output, framework).toContain("useJsonParser(content, kit.schema)");
    expect(output, framework).not.toContain("snippet skipped:");
  }
});

test("the JSON Render guide resolves the selected Showcase catalog, registry, and parser", () => {
  const source = loadDoc("generative-ui/json-render")?.source ?? "";
  expect(source).toContain('cell="declarative-json-render"');
  expect(source).toContain(
    'file="src/app/demos/declarative-json-render/catalog.ts"',
  );
  expect(source).toContain(
    'file="src/app/demos/declarative-json-render/registry.tsx"',
  );
  expect(source).not.toContain("stripCodeFencesAndPrelude");
  expect(source).not.toContain("tolerantJsonParse");

  for (const framework of selectedFrameworks) {
    const output = renderGuide("generative-ui/json-render", framework);
    expect(output, framework).toContain("defineCatalog");
    expect(output, framework).toContain("defineRegistry");
    expect(output, framework).toContain("JSONUIProvider");
    expect(output, framework).toContain("extractJsonObject");
    expect(output, framework).not.toContain("snippet skipped:");
  }
});
