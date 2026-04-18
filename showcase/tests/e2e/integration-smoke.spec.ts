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
import registry from "../../shell/src/data/registry.json";

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
const SMOKE_ALL = process.env.SMOKE_ALL === "true";
const activeIntegrations = SMOKE_ALL
  ? INTEGRATIONS
  : INTEGRATIONS.filter((i) => i.deployed);

// ---------------------------------------------------------------------------
// Level 1: Health checks (@health) — fast, API-only
// ---------------------------------------------------------------------------

test.describe("Level 1: Backend Health @health", () => {
  for (const integration of activeIntegrations) {
    test(`[L1: health] ${integration.slug} backend is healthy @health`, async ({
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
    test(`[L2: agent] ${integration.slug} agent endpoint responds (not 404) @agent`, async ({
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
    test(`[L3: chat] ${integration.slug} responds to a message @chat`, async ({
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
    test(`[L4: tools] ${integration.slug} renders tool results @tools`, async ({
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

      // Check for rendered components (not just text) — catches the query_data
      // loop bug where the agent returns text but never renders a chart/card.
      const responseArea = page
        .locator('[data-testid="copilot-assistant-message"]')
        .last();
      const checks = await Promise.all([
        responseArea
          .locator(".recharts-wrapper")
          .first()
          .isVisible()
          .catch(() => false),
        responseArea
          .locator("svg circle[stroke-dasharray]")
          .first()
          .isVisible()
          .catch(() => false),
        responseArea
          .locator('[data-testid="weather-card"]')
          .first()
          .isVisible()
          .catch(() => false),
        responseArea
          .locator("canvas")
          .first()
          .isVisible()
          .catch(() => false),
      ]);
      const hasRenderedComponent = checks.some(Boolean);

      // Warning for now — upgrade to hard failure after data-testid convention
      // is established across all integrations
      if (!hasRenderedComponent) {
        console.warn(
          `\u26a0\ufe0f ${integration.slug}: Tool response contains text but no rendered chart/weather component. This would have missed the query_data loop bug.`,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Deployed Starters: L1-L3 smoke tests (@starter-health, @starter-agent, @starter-chat)
// ---------------------------------------------------------------------------

interface Starter {
  slug: string;
  name: string;
  demoUrl: string;
}

type RegistryIntegration = (typeof registry)["integrations"][number];

const STARTER_SLUG = process.env.STARTER_SLUG;

// Registry uses integration-level `deployed` as the single deployment flag.
// An earlier iteration had `starter.deployed` as a per-starter override, but
// the manifest→registry bundler (showcase/scripts/bundle-demo-content.ts +
// generate-registry.ts) doesn't carry that field forward from the source YAML
// manifests, so any value written there is dropped on regen. Gating on
// `i.deployed === true` matches how the INTEGRATIONS array above filters
// `activeIntegrations` and keeps both filters anchored to the same source of
// truth. Without this, the Deployed Starters describe block yields zero tests
// and Playwright's --grep fails with "No tests found."
const STARTERS: Starter[] = registry.integrations
  .filter(
    (
      i,
    ): i is RegistryIntegration & {
      starter: NonNullable<RegistryIntegration["starter"]>;
    } =>
      Boolean(i.starter?.demo_url) &&
      (!STARTER_SLUG || i.slug === STARTER_SLUG) &&
      (SMOKE_ALL || i.deployed === true),
  )
  .map((i) => ({
    slug: i.slug,
    name: i.starter.name,
    demoUrl: i.starter.demo_url,
  }));

test.describe("Deployed Starters", () => {
  for (const starter of STARTERS) {
    // Single test per starter so L2/L3 are naturally skipped when L1 fails.
    // (fullyParallel: true in playwright.config.ts overrides describe.configure serial mode)
    test(`[Starter] ${starter.slug} deployed smoke @starter-health @starter-agent @starter-chat`, async ({
      request,
      page,
    }) => {
      // L1: Health — 3 retries with 15s delay to handle Railway cold starts
      const health = await checkHealth(
        request,
        starter.demoUrl,
        undefined,
        3,
        15_000,
      );
      expect(
        health.ok,
        `${starter.slug} starter health check failed: status=${health.status} path=${health.path} body=${health.body.slice(0, 500)}`,
      ).toBe(true);

      // L2: Agent endpoint reachability
      const agent = await checkAgentEndpoint(request, starter.demoUrl);
      expect(
        agent.status,
        `${starter.slug} starter agent endpoint returned 404. Status=${agent.status} body=${agent.body.slice(0, 500)}`,
      ).not.toBe(404);
      expect(
        agent.ok,
        `${starter.slug} starter agent endpoint is unreachable: status=${agent.status} body=${agent.body.slice(0, 500)}`,
      ).toBe(true);

      // L3: Round-trip chat
      test.slow(); // Allow extra time for cold starts
      const chat = await sendChatMessage(page, starter.demoUrl, "Hello", "/");
      expect(
        chat.gotResponse,
        `${starter.slug} starter did not produce an assistant response.`,
      ).toBe(true);
      expect(
        chat.responseText.length,
        `${starter.slug} starter assistant response was empty`,
      ).toBeGreaterThan(0);
    });
  }
});
