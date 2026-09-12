import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const ROUTE = "frontends/vue/guides/generative-ui";

function loadVueGenerativeUiDoc() {
  const doc = loadDoc(ROUTE);
  expect(doc, ROUTE).not.toBeNull();
  return doc!;
}

// `@copilotkit/vue/v2` exports its own `useComponent` — a Vue-native composable, not the
// React one — and it is the shortest path to the case this guide's "your components" row
// covers: the agent decides when to show a component and nothing else runs. The guide
// shipped naming only `useRenderTool` and `useFrontendTool`, both of which ask the reader
// for more than the case needs, and it is the page a developer lands on after the
// onboarding graph has already told them to reach for `useComponent` (OSS-1034).
test("the Vue generative-UI guide teaches the useComponent composable", () => {
  const doc = loadVueGenerativeUiDoc();
  const source = readFileSync(doc.filePath, "utf8");
  const llmText = renderPageToLlmText({
    url: `vue/guides/generative-ui`,
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
    // The distinction is the whole point of having both. `useComponent` declares the tool
    // from the frontend; `useRenderTool` draws a tool the agent already owns.
    expect(output, "separates it from useRenderTool").toContain(
      "already owns the tool",
    );
  }
});

// A reader choosing a path reads the table, not the body. Naming the composable only in
// prose leaves the table recommending the longer route for the simpler job.
test("the Vue path table offers useComponent for a display-only component", () => {
  const source = readFileSync(loadVueGenerativeUiDoc().filePath, "utf8");
  const tableRows = source
    .split("\n")
    .filter((line) => line.startsWith("| ") && line.includes("|"));

  const displayOnlyRow = tableRows.find((row) => row.includes("useComponent"));
  expect(displayOnlyRow, "a path-table row names useComponent").toBeDefined();
});
