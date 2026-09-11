import { readFileSync } from "node:fs";
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

test("expands the Rich Threads agent prompt for Markdown and LLM readers", () => {
  const doc = loadDoc("backend/runtime-endpoints");
  if (!doc) throw new Error("Runtime endpoints doc is missing");

  const output = renderPageToLlmText({
    url: "backend/runtime-endpoints",
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: "backend/runtime-endpoints",
  });

  // The route owns the instructions; the raw-Markdown route only has to
  // carry the command that reaches it. See `createFeatureSetupPrompt`.
  expect(output).toContain(
    "npx --yes copilotkit@latest onboard start --coding-agent <coding-agent-slug> --intent add-rich-threads",
  );
  expect(output).not.toContain("<RichThreadsSetupPrompt />");
});

test("reuses the canonical Rich Threads prompt in the Threads overview", () => {
  const doc = loadDoc("threads");
  if (!doc) throw new Error("Threads overview is missing");

  const overviewSource = readFileSync(
    new URL(
      "../../content/snippets/shared/threads/overview.mdx",
      import.meta.url,
    ),
    "utf8",
  );
  expect(overviewSource).toContain("<RichThreadsSetupPrompt />");
  expect(overviewSource).not.toContain(
    "Set up and verify a CopilotKit Rich Threads application",
  );

  const output = renderPageToLlmText({
    url: "threads",
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: "threads",
  });

  expect(output).toContain(
    "npx --yes copilotkit@latest onboard start --coding-agent <coding-agent-slug> --intent add-rich-threads",
  );
  expect(output).not.toContain("<RichThreadsSetupPrompt />");
});
