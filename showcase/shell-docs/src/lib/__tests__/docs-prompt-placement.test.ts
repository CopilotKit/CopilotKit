import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { hasInContentPrompt } from "../docs-prompt-placement";
import { CONTENT_DIR, inlineSnippets } from "../docs-render";

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? mdxFiles(path)
      : path.endsWith(".mdx")
        ? [path]
        : [];
  });
}

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

test("every authored quickstart has one contextual agent section", () => {
  const files = mdxFiles(CONTENT_DIR).filter(
    (file) =>
      file.replaceAll("\\", "/").endsWith("/quickstart.mdx") &&
      file !== join(CONTENT_DIR, "quickstart.mdx"),
  );
  files.push(
    ...["angular", "vue", "react-native", "react-spa", "slack", "teams"].map(
      (name) => join(CONTENT_DIR, "frontends", `${name}.mdx`),
    ),
  );
  expect(files.length).toBeGreaterThan(20);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source.match(/## Start with your coding agent/g), file).toHaveLength(
      1,
    );
    expect(
      source.match(/<(?:PageAgentPrompt|RichThreadsSetupPrompt)\s*\/>/g),
      file,
    ).toHaveLength(1);
    expect(source, file).not.toContain("<IntelligenceOnboardingPrompt");
  }
});

test("Learning offers its agent section before numbered manual setup", () => {
  const source = readFileSync(join(CONTENT_DIR, "learning.mdx"), "utf8");
  expect(source.indexOf("## Start with your coding agent")).toBeLessThan(
    source.indexOf("<LearningSetupPrompt />"),
  );
  expect(source.indexOf("<LearningSetupPrompt />")).toBeLessThan(
    source.indexOf("## Set up Learning manually"),
  );
  expect(source.indexOf("## Set up Learning manually")).toBeLessThan(
    source.indexOf("<Steps>"),
  );
  expect(source.match(/<LearningSetupPrompt\s*\/>/g)).toHaveLength(1);
});
