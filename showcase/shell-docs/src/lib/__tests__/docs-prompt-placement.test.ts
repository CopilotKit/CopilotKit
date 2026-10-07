import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { hasInContentPrompt } from "../docs-prompt-placement";
import { CONTENT_DIR, inlineSnippets } from "../docs-render";

test("body prompts take precedence, including prompts inherited from snippets", () => {
  for (const slug of [
    "integrations/mastra/index",
    "integrations/microsoft-agent-framework/index",
    "learning",
    "intelligence/memories",
    "intelligence/quickstart",
    "webmcp",
    "backend/runtime-endpoints",
    "threads",
    "headless-threads",
    "channels/index",
  ]) {
    const source = readFileSync(join(CONTENT_DIR, `${slug}.mdx`), "utf8");
    expect(hasInContentPrompt(inlineSnippets(source, slug)), slug).toBe(true);
  }
  expect(
    hasInContentPrompt(
      "```mdx\n<LearningSetupPrompt />\n```\n{/* <PageAgentPrompt /> */}",
    ),
  ).toBe(false);
  expect(
    hasInContentPrompt("## An ordinary guide\nNo body-owned prompt."),
  ).toBe(false);
});
