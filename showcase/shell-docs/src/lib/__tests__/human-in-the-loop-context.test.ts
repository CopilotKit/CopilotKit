import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

test("keeps Google ADK on its supported tool-based HITL path", () => {
  const doc = loadDoc("human-in-the-loop");
  if (!doc) throw new Error("Missing HITL overview");

  const output = renderPageToLlmText(
    {
      url: "google-adk/human-in-the-loop",
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug: "human-in-the-loop",
    },
    { framework: "google-adk" },
  );

  expect(output).toContain("Tool-based approval");
  expect(output).toContain("declares frontend-tool support");
  expect(output).toContain("Google ADK has no equivalent native");
  expect(output).toContain("interrupt primitive");
  expect(output).toContain("useHumanInTheLoop");
  expect(output).toContain("tool-based user confirmation");
  expect(output).not.toContain("for graph-paused pauses");
  expect(output).not.toContain("the steering wheel");
  expect(output).not.toContain("folded back into its reasoning");
  expect(output).not.toContain("Pattern 2 — `useInterrupt` (graph-paused)");
});

test("keeps the native LangGraph interrupt path available", () => {
  const doc = loadDoc("human-in-the-loop");
  if (!doc) throw new Error("Missing HITL overview");

  const output = renderPageToLlmText(
    {
      url: "langgraph-python/human-in-the-loop",
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug: "human-in-the-loop",
    },
    { framework: "langgraph-python" },
  );

  expect(output).toContain(
    "Native graph interrupts are a different capability",
  );
  expect(output).toContain("interrupt(...)");
  expect(output).toContain("useInterrupt");
  expect(output).not.toContain("<FrameworkSetup");
});
