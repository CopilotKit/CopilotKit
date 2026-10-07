import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

import setupContentData from "@/data/setup-content.json";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";
import { resolveBundledSetupConcept } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";

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

// REPAIR-038: LangGraph TypeScript agents build their executable graph with a
// Showcase-only header-forwarding helper. Published regions and setup must
// show plain `new ChatOpenAI(...)`, while the servers keep loading the
// header-forwarding `showcaseGraph` exports.
const langgraphTypeScriptAgentRoot = path.resolve(
  import.meta.dirname,
  "../../../../integrations/langgraph-typescript/src/agent",
);

function publishedRegionBodies(source: string): string[] {
  const lines = source.split("\n");
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*\/\/\s*(?:@region\[([^\]]+)\]|region:\s*(\S+))\s*$/.exec(
      lines[i],
    );
    if (!open) continue;
    const end = open[1]
      ? new RegExp(
          `^\\s*//\\s*@endregion\\[${open[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`,
        )
      : /^\s*\/\/\s*endregion\b/;
    const close = lines.findIndex((line, j) => j > i && end.test(line));
    if (close === -1) throw new Error(`Unterminated region at line ${i + 1}`);
    bodies.push(lines.slice(i + 1, close).join("\n"));
  }
  return bodies;
}

test("LangGraph TypeScript published regions and setup use only public model construction", () => {
  const agentFiles = fs
    .readdirSync(langgraphTypeScriptAgentRoot)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  let regionCount = 0;
  for (const file of agentFiles) {
    const source = fs.readFileSync(
      path.join(langgraphTypeScriptAgentRoot, file),
      "utf8",
    );
    for (const body of publishedRegionBodies(source)) {
      regionCount++;
      expect(body, file).not.toContain("makeChatOpenAI");
      expect(body, file).not.toContain("./openai-headers");
    }
  }
  expect(regionCount).toBeGreaterThan(0);

  const setupContent = setupContentData as SetupContentBundle;
  for (const concept of [
    "agent-setup",
    "agent-config-setup",
    "frontend-tools-setup",
    "tool-rendering-setup",
  ]) {
    const setup = resolveBundledSetupConcept(
      "langgraph-typescript",
      concept,
      setupContent,
    );
    expect(setup, concept).toContain("new ChatOpenAI({");
    expect(setup, concept).not.toContain("makeChatOpenAI");
    expect(setup, concept).not.toContain("@region[");
  }

  const config = JSON.parse(
    fs.readFileSync(
      path.join(langgraphTypeScriptAgentRoot, "langgraph.json"),
      "utf8",
    ),
  ) as { graphs: Record<string, string> };
  const server = fs.readFileSync(
    path.join(langgraphTypeScriptAgentRoot, "server.mjs"),
    "utf8",
  );
  const showcaseGraphs = Object.values(config.graphs).filter((spec) =>
    spec.endsWith(":showcaseGraph"),
  );
  expect(showcaseGraphs).toContain("./gen-ui-agent.ts:showcaseGraph");
  for (const spec of showcaseGraphs) {
    expect(server, spec).toContain(`"${spec}"`);
  }
});
