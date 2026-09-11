import { expect, test } from "vitest";

import setupContentData from "@/data/setup-content.json";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { resolveBundledSetupConcept } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";

const setupContent = setupContentData as SetupContentBundle;

function setup(concept: string): string {
  const source = resolveBundledSetupConcept("strands", concept, setupContent);
  if (source === null) throw new Error(`Missing Strands setup: ${concept}`);
  return source;
}

function render(loadSlug: string): string {
  const doc = loadDoc(loadSlug);
  if (!doc) throw new Error(`Missing guide: ${loadSlug}`);
  return renderPageToLlmText(
    {
      url: `aws-strands/${loadSlug}`,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug,
      framework: "strands",
    },
    { framework: "strands" },
  );
}

test("Strands setup fragments extract the state and context bridges", () => {
  expect(setup("shared-state-setup")).toContain("def build_state_prompt");
  expect(setup("shared-state-setup")).toContain("_format_recipe_block");
  expect(setup("agent-context-setup")).toContain("def _format_context_block");
  expect(setup("agent-config-setup")).toContain("def _format_context_block");
  expect(setup("agent-config-setup")).toContain("def build_state_prompt");
});

test("Strands root guides expand their matching setup rather than leaving tags", () => {
  const sharedState = render("shared-state");
  expect(sharedState).toContain("def build_state_prompt");
  expect(sharedState).toContain("_format_recipe_block");
  expect(sharedState).not.toContain("<FrameworkSetup");
  expect(sharedState).not.toContain("<DemoCode");

  const readOnlyContext = render("shared-state/agent-readonly");
  expect(readOnlyContext).toContain("def _format_context_block");
  expect(readOnlyContext).toContain("Context for this conversation");
  expect(readOnlyContext).not.toContain("<FrameworkSetup");
  expect(readOnlyContext).not.toContain("<DemoCode");

  const agentConfig = render("agent-config");
  expect(agentConfig).toContain("def _format_context_block");
  expect(agentConfig).toContain("def build_state_prompt");
  expect(agentConfig).not.toContain("<FrameworkSetup");
  expect(agentConfig).not.toContain("<DemoCode");
});
