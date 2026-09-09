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

  expect(output).toContain(
    "Read https://docs.copilotkit.ai/learning and set up Automatic Learning",
  );
  expect(output).toContain(
    "do not add the deprecated `\u0275learning` Runtime option",
  );
  expect(output).toContain("keep each Thread's assignment stable");
  expect(output).not.toContain("<LearningSetupPrompt />");
});
