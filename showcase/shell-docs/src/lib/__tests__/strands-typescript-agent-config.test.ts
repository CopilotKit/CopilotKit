import { expect, test } from "vitest";

import setupContentData from "@/data/setup-content.json";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { resolveBundledSetupConcept } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";

test("renders the Strands TypeScript agent-config bridge", () => {
  const setup = resolveBundledSetupConcept(
    "strands-typescript",
    "agent-config-setup",
    setupContentData as SetupContentBundle,
  );

  expect(setup).toContain("stateContextBuilder: buildStatePrompt");
  expect(setup).toContain("inputData.context");
  expect(setup).not.toContain("@region[");

  const doc = loadDoc("agent-config");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "strands-typescript/agent-config",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "agent-config",
      framework: "strands-typescript",
    },
    { framework: "strands-typescript" },
  );

  expect(output).toContain("stateContextBuilder: buildStatePrompt");
  expect(output).toContain("inputData.context");
  expect(output).not.toContain('title="backend/agent.py');
  expect(output).not.toContain("def read_config_value");
});

test("renders the Strands TypeScript sub-agent state callback for LLM readers", () => {
  const doc = loadDoc("multi-agent/subagents");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "strands-typescript/multi-agent/subagents",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "multi-agent/subagents",
      framework: "strands-typescript",
    },
    { framework: "strands-typescript" },
  );

  expect(output).toContain("export function makeSubagentStateFromResult");
  expect(output).toContain("function readSubagentTask");
  expect(output).toContain("StateSnapshotEvent");
  expect(output).toContain("Promise<StatePayload | null>");
  expect(output).not.toContain("@region[");

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
  expect(otherFramework).not.toContain(
    "export function makeSubagentStateFromResult",
  );
});
