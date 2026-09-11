import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

function render(loadSlug: string, url: string, framework: string): string {
  const doc = loadDoc(loadSlug);
  if (!doc) throw new Error(`Missing guide: ${loadSlug}`);
  return renderPageToLlmText(
    {
      url,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug,
      framework,
    },
    { framework },
  );
}

test("selected Interactive guides use their local HITL demo source", () => {
  const cases = [
    {
      loadSlug:
        "integrations/langgraph/generative-ui/your-components/interactive",
      url: "langgraph-python/generative-ui/your-components/interactive",
      framework: "langgraph-python",
    },
    {
      loadSlug:
        "integrations/langgraph/generative-ui/your-components/interactive",
      url: "langgraph-typescript/generative-ui/your-components/interactive",
      framework: "langgraph-typescript",
    },
    {
      loadSlug:
        "integrations/aws-strands/generative-ui/your-components/interactive",
      url: "aws-strands/generative-ui/your-components/interactive",
      framework: "strands",
    },
    {
      loadSlug:
        "integrations/built-in-agent/generative-ui/your-components/interactive",
      url: "built-in-agent/generative-ui/your-components/interactive",
      framework: "built-in-agent",
    },
  ];

  for (const route of cases) {
    const output = render(route.loadSlug, route.url, route.framework);
    expect(output, route.url).toContain("useHumanInTheLoop");
    expect(output, route.url).toContain(
      "Try asking the agent to arrange a meeting",
    );
    expect(output, route.url).not.toContain("feature-viewer.copilotkit.ai");
    expect(output, route.url).not.toContain("<Snippet");
    expect(output, route.url).not.toContain("Missing snippet");
  }
});

test("Built-in Agent frontend and tool rendering guides use local Showcase regions", () => {
  const frontendTools = render(
    "integrations/built-in-agent/frontend-tools",
    "built-in-agent/frontend-tools",
    "built-in-agent",
  );
  expect(frontendTools).toContain('name: "change_background"');
  expect(frontendTools).toContain(
    "Ask the Showcase agent to change the page background",
  );
  expect(frontendTools).not.toContain("feature-viewer.copilotkit.ai");
  expect(frontendTools).not.toContain("<Snippet");
  expect(frontendTools).not.toContain("Missing snippet");

  const toolRendering = render(
    "integrations/built-in-agent/generative-ui/tool-rendering",
    "built-in-agent/generative-ui/tool-rendering",
    "built-in-agent",
  );
  expect(toolRendering).toContain('name: "get_weather"');
  expect(toolRendering).toContain("useDefaultRenderTool");
  expect(toolRendering).not.toContain("feature-viewer.copilotkit.ai");
  expect(toolRendering).not.toContain("<Snippet");
  expect(toolRendering).not.toContain("Missing snippet");
});

test("Built-in Agent agent config shows its provider and in-process factory", () => {
  const output = render(
    "agent-config",
    "built-in-agent/agent-config",
    "built-in-agent",
  );

  expect(output).toContain("properties={config}");
  expect(output).toContain("input.forwardedProps");
  expect(output).toContain("buildConfigSystemPrompt(props)");
  expect(output).not.toContain("agentConfigFactory");
  expect(output).not.toContain("makeAgent({ systemPrompt");
  expect(output).not.toContain("Missing snippet");
});
