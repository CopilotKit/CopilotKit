import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

test("offers the Automatic Learning prompt before the manual setup steps", () => {
  const source = loadDoc("learning")?.source ?? "";
  const prompt = source.indexOf("<LearningSetupPrompt />");
  const manualSetup = source.indexOf("### Connect CopilotKit Intelligence");

  expect(prompt).toBeGreaterThan(-1);
  expect(manualSetup).toBeGreaterThan(prompt);
});

test("expands the Automatic Learning prompt for Markdown and LLM readers", () => {
  const doc = loadDoc("learning");
  if (!doc) throw new Error("Learning doc is missing");

  const output = renderPageToLlmText({
    url: "learning",
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: "learning",
  });

  // The route owns the instructions; the raw-Markdown route only has to
  // carry the command that reaches it. See `createFeatureSetupPrompt`.
  expect(output).toContain(
    "npx --yes copilotkit@latest onboard start --intent add-learning",
  );
  expect(output).not.toContain("<LearningSetupPrompt />");
});
