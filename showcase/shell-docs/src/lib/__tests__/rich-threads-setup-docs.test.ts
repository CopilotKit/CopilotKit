import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

test("offers the Rich Threads agent prompt before the manual repair steps", () => {
  const source = loadDoc("backend/runtime-endpoints")?.source ?? "";
  const prompt = source.indexOf("<RichThreadsSetupPrompt />");
  const manualSteps = source.indexOf("<Steps>", prompt);

  expect(prompt).toBeGreaterThan(-1);
  expect(manualSteps).toBeGreaterThan(prompt);
});

test.each([
  "backend/runtime-endpoints",
  "threads",
  "integrations/mastra/threads",
])(
  "expands the Rich Threads agent prompt for Markdown and LLM readers on %s",
  (slug) => {
    const doc = loadDoc(slug);
    if (!doc) throw new Error(`Doc is missing: ${slug}`);

    const output = renderPageToLlmText({
      url: slug,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug: slug,
    });

    // The route owns the instructions; the raw-Markdown route only has to
    // carry the command that reaches it. See `createFeatureSetupPrompt`.
    expect(output).toContain(
      "npx --yes copilotkit@latest onboard start --intent add-rich-threads",
    );
    expect(output).not.toContain("<RichThreadsSetupPrompt />");
  },
);
