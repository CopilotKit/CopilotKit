import { describe, expect, it } from "vitest";
import { resolveBundledSetupConcept, setupContentKey } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";
import { getDocsMode, getIntegrations } from "../registry";
import setupContentData from "@/data/setup-content.json";

const bundle: SetupContentBundle = {
  version: 1,
  concepts: {
    "langgraph-python::agent-setup": {
      framework: "langgraph-python",
      concept: "agent-setup",
      source: "# LangGraph setup\n",
    },
  },
};

describe("setup content bundle", () => {
  it("uses framework and concept as the stable lookup key", () => {
    expect(setupContentKey("langgraph-python", "agent-setup")).toBe(
      "langgraph-python::agent-setup",
    );
  });

  it("returns the bundled source when the framework concept exists", () => {
    expect(
      resolveBundledSetupConcept("langgraph-python", "agent-setup", bundle),
    ).toBe("# LangGraph setup\n");
  });

  it("falls back from LangGraph FastAPI to the Python setup content", () => {
    expect(
      resolveBundledSetupConcept("langgraph-fastapi", "agent-setup", bundle),
    ).toBe("# LangGraph setup\n");
  });

  it("returns null when the framework concept is absent", () => {
    expect(
      resolveBundledSetupConcept("google-adk", "agent-setup", bundle),
    ).toBe(null);
    expect(
      resolveBundledSetupConcept("langgraph-python", "missing", bundle),
    ).toBe(null);
  });

  it("bundles non-empty Claude Agent SDK setup content for rendered quickstarts", () => {
    const setupContent = setupContentData as SetupContentBundle;

    for (const framework of ["claude-sdk-python", "claude-sdk-typescript"]) {
      const source = resolveBundledSetupConcept(
        framework,
        "agent-setup",
        setupContent,
      );

      expect(source, framework).toContain("ClaudeAgentAdapter");
      expect(source, framework).toMatch(/```|~~~/);
      expect(source, framework).not.toContain("<DemoCode");
      expect(source, framework).not.toContain("@region[");
    }
  });

  it("bundles the Google ADK state-streaming termination setup", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const source = resolveBundledSetupConcept(
      "google-adk",
      "state-streaming-setup",
      setupContent,
    );

    expect(source).toContain("after_model_callback=stop_on_terminal_text");
    expect(source).toContain("shared_chat.py");
    expect(source).not.toContain("def stop_on_terminal_text(");
    expect(source).not.toContain("<DemoCode");
    expect(source).not.toContain("@region[");
  });

  it.each([
    [
      "claude-sdk-python",
      [
        "create_sdk_mcp_server(",
        'options["mcp_servers"]',
        'options["allowed_tools"]',
        "ClaudeAgentAdapter(",
        "sdk_tool_handler",
        "register this schema as an executable backend tool",
      ],
    ],
    [
      "claude-sdk-typescript",
      [
        "createSdkMcpServer({",
        "mcpServers: backendToolServer.mcpServers",
        "allowedTools: backendToolServer.allowedTools",
        "new ClaudeAgentAdapter({",
        "sdkTool(",
        "register this schema as an executable backend tool",
      ],
    ],
  ])(
    "bundles executable tool-rendering wiring for %s",
    (framework, expectedIdentifiers) => {
      const setupContent = setupContentData as SetupContentBundle;
      const source = resolveBundledSetupConcept(
        framework,
        "tool-rendering-setup",
        setupContent,
      );

      for (const identifier of expectedIdentifiers) {
        expect(source, `${framework}: ${identifier}`).toContain(identifier);
      }
      expect(source, framework).not.toContain("<DemoCode");
      expect(source, framework).not.toContain("@region[");
    },
  );

  it.each([
    [
      "claude-sdk-python",
      [
        "tools=[SET_NOTES_TOOL]",
        'if tc["name"] == "set_notes"',
        "StateSnapshotEvent",
        "ToolCallResultEvent",
        "run_shared_state_read_write_agent",
        "intentionally uses its own Messages API loop",
      ],
    ],
    [
      "claude-sdk-typescript",
      [
        "toolSchemas: [SET_NOTES_TOOL_SCHEMA] as Anthropic.Tool[]",
        "runWithClaudeAgentSdk({",
        "createSdkMcpServer({",
        "mcp__copilotkit__set_notes",
        'toolName === "set_notes"',
        "direct Anthropic Messages API fallback",
      ],
    ],
  ])(
    "bundles executable shared-state wiring for %s",
    (framework, expectedIdentifiers) => {
      const setupContent = setupContentData as SetupContentBundle;
      const source = resolveBundledSetupConcept(
        framework,
        "shared-state-setup",
        setupContent,
      );

      for (const identifier of expectedIdentifiers) {
        expect(source, `${framework}: ${identifier}`).toContain(identifier);
      }
      expect(source, framework).not.toContain("<DemoCode");
      expect(source, framework).not.toContain("@region[");
    },
  );

  it("bundles the Claude TypeScript fixed-schema backend wiring", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const source = resolveBundledSetupConcept(
      "claude-sdk-typescript",
      "a2ui-fixed-schema-setup",
      setupContent,
    );

    expect(source).toContain('if (toolName === "display_flight")');
    expect(source).toContain("shouldUseClaudeAgentSdk({");
    expect(source).toContain("runWithClaudeAgentSdk({");
    expect(source).toContain("new ClaudeAgentAdapter({");
    expect(source).toContain("createSdkMcpServer({");
    expect(source).toContain("mcpServers: backendToolServer.mcpServers");
    expect(source).toContain("allowedTools: backendToolServer.allowedTools");
    expect(source).toContain("mcp__copilotkit__display_flight");
    expect(source).toContain(
      "toolSchemas: [DISPLAY_FLIGHT_TOOL_SCHEMA] as Anthropic.Tool[]",
    );
    expect(source).not.toContain("no MCP server");
    expect(source).not.toContain("<DemoCode");

    const publicFrameworks = getIntegrations()
      .filter((integration) => getDocsMode(integration.slug) !== "hidden")
      .map((integration) => integration.slug)
      .filter((framework) => framework !== "claude-sdk-typescript");
    for (const framework of publicFrameworks) {
      const other = resolveBundledSetupConcept(
        framework,
        "a2ui-fixed-schema-setup",
        setupContent,
      );
      if (other === null) continue;
      expect(other, framework).not.toContain("new ClaudeAgentAdapter({");
      expect(other, framework).not.toContain("createSdkMcpServer({");
      expect(other, framework).not.toContain(
        "toolSchemas: [DISPLAY_FLIGHT_TOOL_SCHEMA] as Anthropic.Tool[]",
      );
    }
  });

  it.each([
    [
      "langgraph-python",
      "a2ui-fixed-schema-setup",
      ["tools=[display_flight]", 'graphId: "a2ui_fixed"'],
    ],
    [
      "langgraph-typescript",
      "a2ui-fixed-schema-setup",
      [
        '.addNode("tool_node", new ToolNode(tools))',
        "...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? [])",
        'graphId: "a2ui_fixed"',
      ],
    ],
    [
      "google-adk",
      "a2ui-fixed-schema-setup",
      [
        "tools=[display_flight, AGUIToolset()]",
        'add_adk_fastapi_endpoint(app, middleware, path=f"/{agent_name}")',
        "url: `${AGENT_URL}/a2ui_fixed_schema`",
      ],
    ],
    [
      "strands",
      "a2ui-fixed-schema-setup",
      [
        "tools=[display_flight]",
        'app.mount("/a2ui-fixed-schema", a2ui_fixed_schema_app)',
        'defaultCatalogId: "copilotkit://flight-fixed-catalog"',
      ],
    ],
    [
      "built-in-agent",
      "a2ui-fixed-schema-setup",
      [
        "tools: [displayFlightTool]",
        '"a2ui-fixed-schema": createA2UIFixedSchemaAgent()',
      ],
    ],
    [
      "langgraph-python",
      "a2ui-recovery-setup",
      ['"recovery": {"maxAttempts": 3}', 'graphId: "a2ui_recovery"'],
    ],
    [
      "langgraph-typescript",
      "a2ui-recovery-setup",
      ["recovery: { maxAttempts: 3 }", 'graphId: "a2ui_recovery"'],
    ],
    [
      "google-adk",
      "a2ui-recovery-setup",
      [
        "get_a2ui_tool(",
        '"recovery": {"maxAttempts": 3}',
        "url: `${AGENT_URL}/a2ui_recovery`",
      ],
    ],
    [
      "strands",
      "a2ui-recovery-setup",
      [
        "config=StrandsAgentConfig(",
        'app.mount("/a2ui-recovery", a2ui_recovery_app)',
        "url: `${AGENT_URL}/a2ui-recovery/`",
      ],
    ],
    [
      "built-in-agent",
      "a2ui-recovery-setup",
      [
        'code: "a2ui_recovery_exhausted"',
        "return createA2uiAgent({ maxAttempts: 3 });",
        'defaultCatalogId: "declarative-gen-ui-catalog"',
      ],
    ],
  ])(
    "bundles %s's own %s wiring",
    (framework, concept, expectedIdentifiers) => {
      const setupContent = setupContentData as SetupContentBundle;
      const source = resolveBundledSetupConcept(
        framework,
        concept,
        setupContent,
      );

      for (const identifier of expectedIdentifiers) {
        expect(source, `${framework}: ${identifier}`).toContain(identifier);
      }
      if (!(framework === "strands" && concept === "a2ui-recovery-setup")) {
        // Strands is the exception: its adapter injects the tool itself.
        expect(source, framework).toContain("injectA2UITool: false");
      }
      expect(source, framework).not.toContain("<DemoCode");
      expect(source, framework).not.toContain("@region[");
    },
  );

  it("resolves Channels agent setup for all 19 public framework choices", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const publicFrameworks = getIntegrations()
      .filter((integration) => getDocsMode(integration.slug) !== "hidden")
      .map((integration) => integration.slug);

    expect(publicFrameworks).toHaveLength(19);
    for (const framework of publicFrameworks) {
      const source = resolveBundledSetupConcept(
        framework,
        "channels-agent-setup",
        setupContent,
      );

      expect(source, framework).toBeTypeOf("string");
      expect(source?.trim().length, framework).toBeGreaterThan(0);
      expect(source, framework).toMatch(/```|~~~/);
      expect(source, framework).not.toContain("<DemoCode");
    }
  });

  it("does not let framework handoffs undo the provider quickstart's exact Runtime pin", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const channelSetups = Object.values(setupContent.concepts).filter(
      (entry) => entry.concept === "channels-agent-setup",
    );

    expect(channelSetups).toHaveLength(19);
    for (const { framework, source } of channelSetups) {
      const runtimeInstalls =
        source.match(
          /^\s*npm\s+(?:install|i)\b[^\n]*@copilotkit\/runtime[^\n]*$/gm,
        ) ?? [];
      const nonExactInstalls = runtimeInstalls.filter(
        (command) => !/\s--save-exact(?:\s|$)/.test(command),
      );

      expect(nonExactInstalls, framework).toEqual([]);
    }
  });

  it("keeps framework-specific Channels handoffs aligned with their quickstarts", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const source = (framework: string) =>
      resolveBundledSetupConcept(
        framework,
        "channels-agent-setup",
        setupContent,
      ) ?? "";

    expect(source("ag2")).toContain("AGENT_URL=http://localhost:8000/weather");
    expect(source("google-adk")).toContain("AGENT_URL=http://localhost:8000/");
    expect(source("google-adk")).toContain(
      "# AGENT_URL=http://localhost:8000/default",
    );
    expect(source("langgraph-fastapi")).toContain("LangGraphHttpAgent");
    expect(source("langgraph-fastapi")).not.toContain("LangGraphAgent({");
    expect(source("mastra")).toContain("/api/copilotkit/agent/myAgent/run");
    expect(source("mastra")).not.toContain("weatherAgent");
    expect(source("crewai-crews")).not.toContain(
      "[CrewAI Crews quickstart](/crewai-crews/quickstart)",
    );
  });
});
