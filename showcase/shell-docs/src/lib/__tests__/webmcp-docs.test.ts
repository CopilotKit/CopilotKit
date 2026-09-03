import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

test("leads the WebMCP guide with repository-aware onboarding", () => {
  const source = loadDoc("webmcp")?.source ?? "";
  const prompt = source.indexOf("<WebMCPOnboardingPrompt />");
  const manualSetup = source.indexOf("## Add WebMCP manually");

  expect(prompt).toBeGreaterThan(-1);
  expect(manualSetup).toBeGreaterThan(prompt);
  expect(source).toContain("You do not need a CopilotKit backend agent");
  expect(source).toContain(
    "React Native does not expose `document.modelContext`",
  );
  expect(source).toContain("Chrome 149");
});

test("expands the WebMCP onboarding CTA for Markdown and LLM readers", () => {
  const doc = loadDoc("webmcp");
  if (!doc) throw new Error("WebMCP guide is missing");

  const output = renderPageToLlmText({
    url: "webmcp",
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: "webmcp",
  });

  expect(output).toContain(
    "npx --yes copilotkit@latest onboard start --coding-agent <coding-agent-slug>",
  );
  expect(output).toContain(
    "The goal of this onboarding run is to get WebMCP working",
  );
  expect(output).not.toContain("<WebMCPOnboardingPrompt />");
});

test("provides an Angular-native WebMCP page for the frontend selector", () => {
  const source = loadDoc("frontends/angular/webmcp")?.source ?? "";

  expect(source).toContain("registerFrontendTool");
  expect(source).toContain("webmcp:");
  expect(source).not.toMatch(/\bReact\b/);
});
