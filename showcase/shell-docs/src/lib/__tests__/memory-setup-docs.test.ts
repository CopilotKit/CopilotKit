import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { MEMORY_SETUP_PROMPT } from "../memory-setup-prompt";

test("Memory offers one agent prompt before manual setup and exports its instructions", () => {
  const slug = "intelligence/memories";
  const doc = loadDoc(slug);
  if (!doc) throw new Error("Memory doc is missing");
  const source = doc.source;
  const agent = source.indexOf("## Start with your coding agent");
  const prompt = source.indexOf("<MemorySetupPrompt />");
  const manual = source.indexOf("## Set up User Memories manually");
  expect(agent).toBeGreaterThan(-1);
  expect(agent).toBeLessThan(prompt);
  expect(prompt).toBeLessThan(manual);
  expect(manual).toBeLessThan(source.indexOf("<Steps>"));
  expect(source.match(/<MemorySetupPrompt\s*\/>/g)).toHaveLength(1);
  expect(source).not.toContain("<IntelligenceOnboardingPrompt");
  const output = renderPageToLlmText({
    url: slug,
    title: doc.fm.title,
    filePath: doc.filePath,
    loadSlug: slug,
  });
  expect(output).toContain(MEMORY_SETUP_PROMPT);
  expect(output).not.toContain("<MemorySetupPrompt");
  expect(output).not.toContain("--intent add-learning");
});
