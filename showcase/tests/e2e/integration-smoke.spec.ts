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

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Try multiple health endpoint paths, return the first that responds 200.
 */
async function checkHealth(
  request: APIRequestContext,
  backendUrl: string,
): Promise<{ ok: boolean; status: number; path: string; body: string }> {
  const paths = ["/api/health", "/health"];
  for (const path of paths) {
    try {
      const res = await request.get(`${backendUrl}${path}`, {
        timeout: 15_000,
      });
      if (res.ok()) {
        return {
          ok: true,
          status: res.status(),
          path,
          body: await res.text(),
        };
      }
    } catch {
      // try next path
    }
  }
  // All paths failed — report the first one tried
  try {
    const res = await request.get(`${backendUrl}${paths[0]}`, {
      timeout: 10_000,
    });
    return {
      ok: false,
      status: res.status(),
      path: paths[0],
      body: await res.text(),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, path: paths[0], body: msg };
  }
}

/**
 * POST to the CopilotKit runtime endpoint to verify the agent is reachable.
 * We send a minimal CopilotKit-shaped request. The key check is that we do NOT
 * get a 404 (which was the HttpAgent->LangGraphAgent bug symptom).
 */
async function checkAgentEndpoint(
  request: APIRequestContext,
  backendUrl: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await request.post(`${backendUrl}/api/copilotkit`, {
      headers: { "Content-Type": "application/json" },
      data: {
        // Minimal CopilotKit request shape — enough to get past routing
        // but not a full valid conversation (we just want non-404)
        messages: [],
        tools: [],
        agentId: "agentic_chat",
      },
      timeout: 15_000,
    });
    // Anything except 404 is acceptable for endpoint reachability
    return {
      ok: res.status() !== 404,
      status: res.status(),
      body: await res.text(),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: msg };
  }
}

/**
 * Navigate to a demo page and interact with the chat.
 * The demo pages are served directly by each integration's Next.js app.
 */
async function sendChatMessage(
  page: Page,
  backendUrl: string,
  message: string,
  demoPath: string = "/demos/agentic-chat",
): Promise<{ gotResponse: boolean; responseText: string }> {
  const demoUrl = `${backendUrl}${demoPath}`;
  await page.goto(demoUrl, { waitUntil: "networkidle", timeout: 30_000 });

  // Wait for the chat UI to be ready — CopilotKit renders a textarea
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 15_000 });

  // Count existing messages before sending
  const messagesBefore = await page
    .locator('[data-testid="copilot-assistant-message"]')
    .count();

  // Type and send
  await textarea.fill(message);
  await textarea.press("Enter");

  // Wait for a new assistant message to appear
  try {
    await page.waitForFunction(
      ({ selector, countBefore }) => {
        const msgs = document.querySelectorAll(selector);
        return msgs.length > countBefore;
      },
      {
        selector: '[data-testid="copilot-assistant-message"]',
        countBefore: messagesBefore,
      },
      { timeout: 60_000 },
    );
  } catch {
    // Fallback: look for any new content that appeared after our message
    // This handles cases where the selector doesn't match
    await page.waitForTimeout(5_000);
  }

  // Extract the latest assistant message text, waiting for content to stream in
  const assistantMessages = page.locator(
    '[data-testid="copilot-assistant-message"]',
  );
  const count = await assistantMessages.count();
  if (count > messagesBefore) {
    const latest = assistantMessages.nth(count - 1);
    // Wait for the message to have non-empty text (streaming may still be in progress)
    try {
      await page.waitForFunction(
        (el) => (el?.textContent?.trim().length ?? 0) > 0,
        await latest.elementHandle(),
        { timeout: 60_000 },
      );
    } catch {
      // Streaming may be slow; continue with whatever we have
    }
    const text = (await latest.textContent()) ?? "";
    return { gotResponse: true, responseText: text.trim() };
  }

  return { gotResponse: false, responseText: "" };
}

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
