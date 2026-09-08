import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const ROUTE = "frontends/vue/generative-ui/tool-based";

function loadVueGenerativeUiDoc() {
  const doc = loadDoc(ROUTE);
  expect(doc, ROUTE).not.toBeNull();
  return doc!;
}

// `@copilotkit/vue/v2` exports its own `useComponent` — a Vue-native composable, not the
// React one — and it is the shortest path to the case where the agent decides
// when to show a component and nothing else runs.
test("the Vue components-as-tools route teaches the useComponent composable", () => {
  const doc = loadVueGenerativeUiDoc();
  const source = readFileSync(doc.filePath, "utf8");
  const llmText = renderPageToLlmText({
    url: `vue/generative-ui/tool-based`,
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: ROUTE,
  });

  for (const output of [source, doc.source, llmText]) {
    expect(output, "names the composable").toContain("useComponent");
    expect(output, "imports it from the Vue package").toMatch(
      /useComponent[^\n]*from "@copilotkit\/vue\/v2"|from "@copilotkit\/vue\/v2"[^\n]*useComponent/,
    );
    // The distinction is the whole point of having both. `useComponent` is
    // the tool; tool rendering wraps an existing backend tool.
    expect(output, "separates it from useRenderTool").toContain(
      "wraps a real backend tool",
    );
  }
});

test("the direct Vue route describes useComponent as the simple generative UI path", () => {
  const source = readFileSync(loadVueGenerativeUiDoc().filePath, "utf8");

  expect(source).toContain("simplest form of Generative UI");
  expect(source).toContain("agent decides when to show it");
});
