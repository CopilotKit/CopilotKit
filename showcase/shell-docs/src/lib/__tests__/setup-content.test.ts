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
    }
  });

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
      expect(
        resolveBundledSetupConcept(
          framework,
          "a2ui-fixed-schema-setup",
          setupContent,
        ),
        framework,
      ).toBe(null);
    }
  });

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
