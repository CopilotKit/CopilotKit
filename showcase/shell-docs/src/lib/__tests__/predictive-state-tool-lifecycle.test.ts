import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { inlineSnippets, loadDoc } from "../docs-render";
import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

const ROUTES = [
  "langgraph-python/shared-state/predictive-state-updates",
  "deepagents/shared-state/predictive-state-updates",
] as const;

function renderRoute(route: (typeof ROUTES)[number]) {
  const page = getAllLlmPages().find((candidate) => candidate.url === route);
  expect(page, route).toBeDefined();

  const doc = loadDoc(page!.loadSlug);
  expect(doc, route).not.toBeNull();

  return {
    source: readFileSync(doc!.filePath, "utf8"),
    visual: inlineSnippets(doc!.source, page!.loadSlug),
    llm: renderPageToLlmText(
      {
        ...page!,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
      },
      { framework: page!.framework },
    ),
  };
}

test.each(ROUTES)(
  "publishes a complete Python predictive-state tool lifecycle on %s",
  (route) => {
    const output = renderRoute(route);

    for (const content of [output.source, output.visual, output.llm]) {
      expect(content).toContain("def step_progress_tool(");
      expect(content).toContain("runtime: ToolRuntime");
      expect(content).toContain("tool_call_id=runtime.tool_call_id");
      expect(content).toMatch(/"messages": \[\s*ToolMessage\(/);
      expect(content).toContain("ToolNode(tools)");
      expect(content).toContain('.add_edge(START, "chat_node")');
      expect(content).toContain('.add_edge("tool_node", "chat_node")');
      expect(content).toContain("frontend_action_names");
      expect(content).toContain("parallel_tool_calls=False");
      expect(content).toContain("MemorySaver()");
      expect(content).toContain("emit_intermediate_state=[");

      expect(content).not.toContain("response.tool_calls[0].get");
      expect(content).not.toContain("goto=END");
    }
  },
);
