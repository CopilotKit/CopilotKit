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
    expect(output, route.url).not.toContain("<!-- snippet skipped:");
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
  expect(frontendTools).not.toContain("<!-- snippet skipped:");

  const toolRendering = render(
    "integrations/built-in-agent/generative-ui/tool-rendering",
    "built-in-agent/generative-ui/tool-rendering",
    "built-in-agent",
  );
  expect(toolRendering).toContain('name: "get_weather"');
  expect(toolRendering).toContain("useDefaultRenderTool");
  expect(toolRendering).not.toContain("feature-viewer.copilotkit.ai");
  expect(toolRendering).not.toContain("<Snippet");
  expect(toolRendering).not.toContain("<!-- snippet skipped:");
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
  expect(output).not.toContain("<!-- snippet skipped:");
  expect(output).toContain("[Quickstart](/quickstart)");
  expect(output).toContain(
    "[`CopilotKitCoreConfig`](/reference/core/types/CopilotKitCoreConfig)",
  );
  expect(output).toContain(
    "[forwarded properties](/backend/custom-agent#with-forwardedprops)",
  );
  expect(output).toContain("choose **casual**, **expert**, and **detailed**");
  expect(output).toContain("Introduce yourself in the style I selected.");
});

test("Built-in Agent MCP Apps guide uses its current runtime configuration", () => {
  const output = render(
    "integrations/built-in-agent/generative-ui/mcp-apps",
    "built-in-agent/generative-ui/mcp-apps",
    "built-in-agent",
  );

  expect(output).toContain("mcpApps: {");
  expect(output).toContain('serverId: "excalidraw"');
  expect(output).toContain("MCPAppsActivityRenderer");
  expect(output).toContain("Ask the Showcase agent to draw a simple diagram");
  expect(output).not.toContain("MCPAppsMiddleware");
  expect(output).not.toContain("<!-- snippet skipped:");
  expect(output).not.toContain("<Snippet");
});

test("selected Display-only guides render their Showcase component and setup", () => {
  const cases = [
    {
      loadSlug:
        "integrations/langgraph/generative-ui/your-components/display-only",
      url: "langgraph-python/generative-ui/your-components/display-only",
      framework: "langgraph-python",
      setup: "CopilotKitMiddleware",
      retired: ["CopilotKitState", "@copilotkit/sdk-js/langgraph"],
    },
    {
      loadSlug:
        "integrations/langgraph/generative-ui/your-components/display-only",
      url: "langgraph-typescript/generative-ui/your-components/display-only",
      framework: "langgraph-typescript",
      setup: "CopilotKitStateAnnotation",
      // Both the annotation and this SDK package are the current TS setup.
      // The positive setup assertion above is the source-provenance contract.
      retired: [],
    },
    {
      loadSlug:
        "integrations/aws-strands/generative-ui/your-components/display-only",
      url: "aws-strands/generative-ui/your-components/display-only",
      framework: "strands",
      setup: "StrandsAgent",
      retired: ["CopilotKitState", "@copilotkit/sdk-js/langgraph"],
    },
    {
      loadSlug:
        "integrations/built-in-agent/generative-ui/your-components/display-only",
      url: "built-in-agent/generative-ui/your-components/display-only",
      framework: "built-in-agent",
      setup: "convertToolsToVercelAITools",
      retired: ["CopilotKitState", "@copilotkit/sdk-js/langgraph"],
    },
  ];

  for (const route of cases) {
    const output = render(route.loadSlug, route.url, route.framework);
    expect(output, route.url).toContain("useComponent({");
    expect(output, route.url).toContain('name: "render_bar_chart"');
    expect(output, route.url).toContain(route.setup);
    expect(output, route.url).toContain(
      "Ask the Showcase agent to show a bar chart",
    );
    for (const retired of route.retired) {
      expect(output, route.url).not.toContain(retired);
    }
    expect(output, route.url).not.toContain("<!-- snippet skipped:");
    expect(output, route.url).not.toContain("<Snippet");
  }
});

test("Built-in Agent Shared State documents the current provider and notes bridge", () => {
  const output = render(
    "integrations/built-in-agent/shared-state",
    "built-in-agent/shared-state",
    "built-in-agent",
  );

  expect(output).toContain('runtimeUrl="/api/copilotkit"');
  expect(output).toContain('agent="shared-state-read-write"');
  expect(output).toContain('"shared-state-read-write": createBuiltInAgent');
  expect(output).toContain("UseAgentUpdate.OnStateChanged");
  expect(output).toContain("EventType.STATE_DELTA");
  expect(output).toContain('path: "/notes"');
  expect(output).toContain("formatSharedStatePreferences");
  expect(output).toContain("const state = input.state;");
  expect(output).toContain("Other Built-in Agent demos do not receive");
  expect(output).toContain("Remember something");
  expect(output).not.toContain("<FrameworkSetup");
  expect(output).not.toContain("<!-- snippet skipped:");
  expect(output).not.toContain("<Snippet");
});

test("selected LangGraph Auth routes render complete current runtime excerpts", () => {
  const cases = [
    {
      framework: "langgraph-python",
      runtimeAgent: 'graphId: "sample_agent"',
    },
    {
      framework: "langgraph-typescript",
      runtimeAgent: 'graphId: "starterAgent"',
    },
  ];

  for (const route of cases) {
    const output = render("auth", `${route.framework}/auth`, route.framework);
    expect(output, route.framework).toContain(
      "Authorization: authorizationHeader",
    );
    expect(output, route.framework).toContain("useSingleEndpoint={false}");
    expect(output, route.framework).toContain("new LangGraphAgent");
    expect(output, route.framework).toContain(route.runtimeAgent);
    expect(output, route.framework).toContain("throw new Response(");
    expect(output, route.framework).toContain("status: 401");
    expect(output, route.framework).toContain(
      'headers: { "content-type": "application/json" }',
    );
    expect(output, route.framework).not.toContain("backend/auth.py");
    expect(output, route.framework).not.toContain("Self-hosted (FastAPI)");
    expect(output, route.framework).not.toContain(
      "properties={{ authorization",
    );
    expect(output, route.framework).not.toContain("<!-- snippet skipped:");
    expect(output, route.framework).not.toContain("<Snippet");
  }
});
