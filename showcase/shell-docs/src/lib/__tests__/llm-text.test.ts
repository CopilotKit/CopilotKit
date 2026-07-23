import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

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

test("swaps only frontend-specific Runtime code in LLM output", () => {
  const doc = loadDoc("backend/copilot-runtime");
  expect(doc).not.toBeNull();
  const page = {
    url: "angular/backend/copilot-runtime",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "backend/copilot-runtime",
  };

  const angular = renderPageToLlmText(page, { frontend: "angular" });
  const react = renderPageToLlmText(page, { frontend: "react" });

  expect(angular).toContain("@copilotkit/angular");
  expect(angular).not.toContain("@copilotkit/react-core");
  expect(react).toContain("@copilotkit/react-core");
  expect(react).not.toContain("@copilotkit/angular");
  expect(angular).not.toContain("<FrontendOnly");
});

test("expands canonical Angular Showcase regions in LLM output", () => {
  const doc = loadDoc("frontends/angular/guides/frontend-tools-generative-ui");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText({
    url: "angular/guides/frontend-tools-generative-ui",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "frontends/angular/guides/frontend-tools-generative-ui",
  });

  expect(output).toContain("features/tools/tool-feature-model.ts");
  expect(output).toContain('name: "change_background"');
  expect(output).not.toContain("<AngularSnippet");
});
