import { expect, test } from "vitest";
import { docCandidateOrder, inlineSnippets, loadDoc } from "../docs-render";
import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

test("Mastra dynamic-schema guide documents its own remote CopilotKit route", () => {
  const slug = "integrations/mastra/generative-ui/a2ui/dynamic-schema";
  expect(
    docCandidateOrder(
      "generated",
      "mastra",
      "generative-ui/a2ui/dynamic-schema",
    )[0],
  ).toBe(slug);
  expect(
    docCandidateOrder(
      "generated",
      "google-adk",
      "generative-ui/a2ui/dynamic-schema",
    )[0],
  ).toBe("generative-ui/a2ui/dynamic-schema");
  const doc = loadDoc(slug);
  expect(doc).not.toBeNull();

  const rendered = inlineSnippets(doc!.source, slug);
  expect(rendered).toContain("registerCopilotKit({");
  expect(rendered).toContain('path: "/copilotkit"');
  expect(rendered).toContain('agentId: "dashboardAgent"');
  expect(rendered).toContain('defaultCatalogId: "declarative-gen-ui-catalog"');
  expect(rendered).toContain("runtimeUrl");
  expect(rendered).toContain("a2ui_operations");
  expect(rendered).not.toContain("ag_ui_langgraph");
  expect(rendered).not.toContain("TOOL_CALL_ARGS");

  const page = getAllLlmPages().find(
    (entry) => entry.url === "mastra/generative-ui/a2ui/dynamic-schema",
  );
  expect(page).toBeDefined();
  const llmText = renderPageToLlmText(page!);
  expect(llmText).toContain("registerCopilotKit");
  expect(llmText).not.toContain("ag_ui_langgraph");
});
