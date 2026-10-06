import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

test("renders the Mastra sub-agent helper and server setup for LLM readers", () => {
  const doc = loadDoc("multi-agent/subagents");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "mastra/multi-agent/subagents",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "multi-agent/subagents",
      framework: "mastra",
    },
    { framework: "mastra" },
  );

  expect(output).toContain(
    "export async function writeDelegationsToWorkingMemory",
  );
  expect(output).toContain("interface MaybeToolExecutionContext");
  expect(output).toContain("async function resolveMemoryAndIds");
  expect(output).toContain("async function readExistingWorkingMemory");
  expect(output).toContain("function logWorkingMemoryFailure");
  expect(output).toContain("registerCopilotKit");
  expect(output).toContain("Keep working memory");
  expect(output).not.toContain("Code tab");
  expect(output).not.toContain("@region[working-memory]");

  const otherFramework = renderPageToLlmText(
    {
      url: "langgraph-python/multi-agent/subagents",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "multi-agent/subagents",
      framework: "langgraph-python",
    },
    { framework: "langgraph-python" },
  );
  expect(otherFramework).not.toContain("registerCopilotKit");
});
