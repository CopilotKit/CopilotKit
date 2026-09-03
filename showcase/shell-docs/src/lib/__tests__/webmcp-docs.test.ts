import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { WEBMCP_SETUP_PROMPT } from "../webmcp-setup-prompt";

test("leads the WebMCP guide with the standalone setup prompt", () => {
  const source = loadDoc("webmcp")?.source ?? "";
  const prompt = source.indexOf("<WebMCPSetupPrompt />");
  const manualSetup = source.indexOf("## Add WebMCP manually");

  expect(prompt).toBeGreaterThan(-1);
  expect(manualSetup).toBeGreaterThan(prompt);
  expect(source).toContain("You do not need a CopilotKit backend agent");
  expect(source).toContain(
    "React Native does not expose `document.modelContext`",
  );
  expect(source).toContain("Chrome 149");
});

test("expands the WebMCP setup CTA for Markdown and LLM readers", () => {
  const doc = loadDoc("webmcp");
  if (!doc) throw new Error("WebMCP guide is missing");

  const output = renderPageToLlmText({
    url: "webmcp",
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: "webmcp",
  });

  expect(output).toContain(WEBMCP_SETUP_PROMPT);
  expect(output).not.toContain("onboard start");
  expect(output).not.toContain("<WebMCPSetupPrompt />");
});

test("provides an Angular-native WebMCP page for the frontend selector", () => {
  const source = loadDoc("frontends/angular/webmcp")?.source ?? "";

  expect(source).toContain("registerFrontendTool");
  expect(source).toContain("webmcp:");
  expect(source).not.toMatch(/\bReact\b/);
});
