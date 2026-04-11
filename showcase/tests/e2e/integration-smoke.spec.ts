/**
 * E2E Smoke Test Suite for Showcase Integrations
 *
 * Tests the full path: Railway backend -> AG-UI protocol -> CopilotKit runtime -> frontend response
 *
 * Levels:
 *   1. @health  - Backend health endpoint returns 200
 *   2. @agent   - Agent endpoint is reachable (not 404)
 *   3. @chat    - Round-trip chat: send message, get assistant response
 *   4. @tools   - Tool rendering: trigger a tool, verify UI result
 *
 * Run all:     npx playwright test
 * Run level:   npx playwright test --grep @health
 * Run one:     npx playwright test --grep "langgraph-python"
 */

import { test, expect } from "@playwright/test";
import { checkHealth, checkAgentEndpoint, sendChatMessage } from "./helpers";

// ---------------------------------------------------------------------------
// Integration registry — source of truth: showcase/shell/src/data/registry.json
// ---------------------------------------------------------------------------

interface Integration {
  slug: string;
  name: string;
  backendUrl: string;
  backendType: "langgraph" | "ag-ui";
  deployed: boolean;
  hasToolRendering: boolean;
  demos: string[];
}

const INTEGRATIONS: Integration[] = [
  {
    slug: "langgraph-python",
    name: "LangGraph (Python)",
    backendUrl: "https://showcase-langgraph-python-production.up.railway.app",
    backendType: "langgraph",
    deployed: true,
    hasToolRendering: true,
    demos: [
      "agentic-chat",
      "hitl",
      "tool-rendering",
      "gen-ui-tool-based",
      "gen-ui-agent",
      "shared-state-read",
      "shared-state-write",
      "shared-state-streaming",
      "subagents",
    ],
  },
  {
    slug: "mastra",
    name: "Mastra",
    backendUrl: "https://showcase-mastra-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "hitl", "tool-rendering", "gen-ui-tool-based"],
  },
  {
    slug: "langgraph-typescript",
    name: "LangGraph (TypeScript)",
    backendUrl:
      "https://showcase-langgraph-typescript-production.up.railway.app",
    backendType: "langgraph",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "crewai-crews",
    name: "CrewAI (Crews)",
    backendUrl: "https://showcase-crewai-crews-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "pydantic-ai",
    name: "PydanticAI",
    backendUrl: "https://showcase-pydantic-ai-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "google-adk",
    name: "Google ADK",
    backendUrl: "https://showcase-google-adk-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "claude-sdk-python",
    name: "Claude Agent SDK (Python)",
    backendUrl: "https://showcase-claude-sdk-python-production.up.railway.app",
    backendType: "ag-ui",
    deployed: false,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "claude-sdk-typescript",
    name: "Claude Agent SDK (TypeScript)",
    backendUrl:
      "https://showcase-claude-sdk-typescript-production.up.railway.app",
    backendType: "ag-ui",
    deployed: false,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "agno",
    name: "Agno",
    backendUrl: "https://showcase-agno-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "ag2",
    name: "AG2",
    backendUrl: "https://showcase-ag2-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "llamaindex",
    name: "LlamaIndex",
    backendUrl: "https://showcase-llamaindex-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "langgraph-fastapi",
    name: "LangGraph (FastAPI)",
    backendUrl: "https://showcase-langgraph-fastapi-production.up.railway.app",
    backendType: "langgraph",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "strands",
    name: "AWS Strands",
    backendUrl: "https://showcase-strands-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "langroid",
    name: "Langroid",
    backendUrl: "https://showcase-langroid-production.up.railway.app",
    backendType: "ag-ui",
    deployed: false,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "ms-agent-python",
    name: "MS Agent Framework (Python)",
    backendUrl: "https://showcase-ms-agent-python-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "ms-agent-dotnet",
    name: "MS Agent Framework (.NET)",
    backendUrl: "https://showcase-ms-agent-dotnet-production.up.railway.app",
    backendType: "ag-ui",
    deployed: true,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
  {
    slug: "spring-ai",
    name: "Spring AI",
    backendUrl: "https://showcase-spring-ai-production.up.railway.app",
    backendType: "ag-ui",
    deployed: false,
    hasToolRendering: true,
    demos: ["agentic-chat", "tool-rendering", "hitl", "gen-ui-tool-based"],
  },
];

// Only test deployed integrations unless SMOKE_ALL=true
const DEPLOYED_ONLY = process.env.SMOKE_ALL !== "true";
const activeIntegrations = DEPLOYED_ONLY
  ? INTEGRATIONS.filter((i) => i.deployed)
  : INTEGRATIONS;

// ---------------------------------------------------------------------------
// Level 1: Health checks (@health) — fast, API-only
// ---------------------------------------------------------------------------

test.describe("Level 1: Backend Health @health", () => {
  for (const integration of activeIntegrations) {
    test(`[health] ${integration.slug} backend is healthy @health`, async ({
      request,
    }) => {
      const result = await checkHealth(request, integration.backendUrl);
      expect(
        result.ok,
        `${integration.slug} health check failed: status=${result.status} path=${result.path} body=${result.body.slice(0, 500)}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Level 2: Agent endpoint reachability (@agent)
// ---------------------------------------------------------------------------

test.describe("Level 2: Agent Endpoint @agent", () => {
  for (const integration of activeIntegrations) {
    test(`[agent] ${integration.slug} agent endpoint responds (not 404) @agent`, async ({
      request,
    }) => {
      const result = await checkAgentEndpoint(request, integration.backendUrl);
      expect(
        result.status,
        `${integration.slug} agent endpoint returned 404 — likely using wrong agent type (LangGraphAgent vs HttpAgent). Status=${result.status} body=${result.body.slice(0, 500)}`,
      ).not.toBe(404);
      expect(
        result.ok,
        `${integration.slug} agent endpoint is unreachable: status=${result.status} body=${result.body.slice(0, 500)}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Level 3: Round-trip chat (@chat) — browser-based
// ---------------------------------------------------------------------------

test.describe("Level 3: Round-trip Chat @chat", () => {
  for (const integration of activeIntegrations) {
    test(`[chat] ${integration.slug} responds to a message @chat`, async ({
      page,
    }) => {
      test.slow(); // Allow extra time for cold starts

      const result = await sendChatMessage(
        page,
        integration.backendUrl,
        "Hello, please respond with a brief greeting.",
        "/demos/agentic-chat",
      );

      expect(
        result.gotResponse,
        `${integration.slug} did not produce an assistant response. The agent may be down, misconfigured, or using the wrong agent type.`,
      ).toBe(true);
      expect(
        result.responseText.length,
        `${integration.slug} assistant response was empty`,
      ).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Level 4: Tool rendering (@tools) — browser-based, subset
// ---------------------------------------------------------------------------

test.describe("Level 4: Tool Rendering @tools", () => {
  const toolIntegrations = activeIntegrations.filter(
    (i) => i.hasToolRendering && i.demos.includes("tool-rendering"),
  );

  for (const integration of toolIntegrations) {
    test(`[tools] ${integration.slug} renders tool results @tools`, async ({
      page,
    }) => {
      test.slow();

      const result = await sendChatMessage(
        page,
        integration.backendUrl,
        "What's the weather in San Francisco?",
        "/demos/tool-rendering",
      );

      // Tool rendering should produce an assistant response
      expect(
        result.gotResponse,
        `${integration.slug} did not render a tool result`,
      ).toBe(true);

      // The response should contain weather-related content
      const responseLC = result.responseText.toLowerCase();
      const hasWeatherContent =
        responseLC.includes("san francisco") ||
        responseLC.includes("weather") ||
        responseLC.includes("temperature") ||
        /\d+/.test(result.responseText); // any number (temperature, etc.)

      expect(
        hasWeatherContent,
        `${integration.slug} response doesn't contain weather info: "${result.responseText}"`,
      ).toBe(true);
    });
  }
});
