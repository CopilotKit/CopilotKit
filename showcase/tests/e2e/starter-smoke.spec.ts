/**
 * E2E smoke tests for Docker-built starter templates.
 *
 * Test levels: @health, @agent, @chat, @interaction
 * Targets a running starter container at STARTER_URL (default localhost:3000).
 * The starter is selected by the STARTER env var (default "langgraph-python").
 *
 * All starters share the same CopilotKit UI shell, so interaction selectors
 * are universal — only the agent backend differs per starter.
 */

import { test, expect } from "@playwright/test";
import {
  checkHealth,
  checkAgentEndpoint,
  sendChatMessage,
  setupConsoleErrorCollector,
} from "./helpers";

// ---------------------------------------------------------------------------
// Starter registry
// ---------------------------------------------------------------------------

interface Starter {
  slug: string;
  path: string;
  healthPaths: string[];
  agentPath: string;
  chatMessage: string;
  expectedChatUiText?: string;
  /** Whether the starter has Chat/App mode toggle */
  hasAppMode: boolean;
}

const DEFAULT_STARTER: Omit<Starter, "slug"> = {
  path: "",
  healthPaths: ["/api/health", "/health", "/"],
  agentPath: "/api/copilotkit",
  chatMessage: "Hello",
  hasAppMode: false,
};

const STARTERS: Starter[] = [
  { ...DEFAULT_STARTER, slug: "langgraph-python", hasAppMode: true },
  { ...DEFAULT_STARTER, slug: "mastra" },
  { ...DEFAULT_STARTER, slug: "langgraph-js", hasAppMode: true },
  { ...DEFAULT_STARTER, slug: "crewai-crews" },
  { ...DEFAULT_STARTER, slug: "crewai-flows" },
  { ...DEFAULT_STARTER, slug: "pydantic-ai" },
  { ...DEFAULT_STARTER, slug: "adk" },
  { ...DEFAULT_STARTER, slug: "agno" },
  { ...DEFAULT_STARTER, slug: "llamaindex" },
  { ...DEFAULT_STARTER, slug: "langgraph-fastapi", hasAppMode: true },
  { ...DEFAULT_STARTER, slug: "strands-python", hasAppMode: true },
  {
    ...DEFAULT_STARTER,
    slug: "strands-typescript",
    chatMessage:
      "First use the query_data tool to fetch the financial sales data, then using A2UI, show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales.",
    expectedChatUiText: "Total Revenue",
    hasAppMode: true,
  },
  { ...DEFAULT_STARTER, slug: "ms-agent-framework-python" },
  { ...DEFAULT_STARTER, slug: "ms-agent-framework-dotnet" },
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STARTER_SLUG = process.env.STARTER ?? "langgraph-python";
const STARTER_URL = process.env.STARTER_URL ?? "http://localhost:3000";
const activeStarter = STARTERS.find((s) => s.slug === STARTER_SLUG);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe(`starter-smoke: ${STARTER_SLUG}`, () => {
  test.skip(!activeStarter, `Unknown starter slug: ${STARTER_SLUG}`);
  const starter = activeStarter!;

  test(`@health ${STARTER_SLUG} — health endpoint responds`, async ({
    request,
  }) => {
    const result = await checkHealth(request, STARTER_URL, starter.healthPaths);
    expect(result.ok, `Health check failed: ${result.body}`).toBe(true);
  });

  test(`@agent ${STARTER_SLUG} — agent endpoint is reachable`, async ({
    request,
  }) => {
    const result = await checkAgentEndpoint(
      request,
      STARTER_URL,
      starter.agentPath,
    );
    expect(result.status, "Agent endpoint returned 404").not.toBe(404);
    expect(result.ok, `Agent check failed: ${result.body}`).toBe(true);
  });

  test(`@chat ${STARTER_SLUG} — chat round-trip via aimock`, async ({
    page,
  }) => {
    test.slow();
    const result = await sendChatMessage(
      page,
      STARTER_URL,
      starter.chatMessage,
    );

    // Protocol-level assertions FIRST. "An assistant message appeared with
    // some text in it" is not a success signal: CopilotKit renders a
    // RUN_ERROR as an assistant message, so a completely broken agent
    // satisfies gotResponse + responseText.length. llamaindex rode that
    // hole through 1345 consecutive failed probe runs while this test was
    // green — the only tell was the run taking 1.1 minutes instead of 1.3
    // seconds. These assertions read the AG-UI transcript off the wire
    // instead, so an errored or hung run fails loudly.
    //
    // The PROTOCOL is the contract, not the DOM. `agui.timedOut` (the wait for
    // a `copilot-assistant-message` testid blew its deadline) is reported in
    // the failure messages for diagnosis but is deliberately NOT a gate on its
    // own: some shells render the reply without that testid, so a timeout there
    // is a rendering detail, not proof the run failed. A genuine hang still
    // fails below — a hung run never reaches RUN_FINISHED.
    const { agui } = result;
    const diag = `[agui runFinished=${agui.runFinished} runError=${agui.runError} sawTextDelta=${agui.sawTextDelta} timedOut=${agui.timedOut} transcriptBytes=${agui.transcriptBytes}]`;
    expect(
      agui.transcriptBytes,
      `No /api/copilotkit traffic captured — the chat never reached the runtime ${diag}`,
    ).toBeGreaterThan(0);
    expect(agui.runError, `AG-UI stream contained a RUN_ERROR ${diag}`).toBe(
      false,
    );
    expect(
      agui.runFinished,
      `AG-UI stream never reached RUN_FINISHED (a hang or an aborted run) ${diag}`,
    ).toBe(true);
    // Only starters whose expected answer IS prose must stream text deltas.
    // strands-typescript answers with an A2UI render (tool calls, no prose),
    // so requiring a TEXT_MESSAGE_CONTENT delta there would be a false red —
    // its `expectedChatUiText` assertion below is the stronger check anyway.
    if (!starter.expectedChatUiText) {
      expect(
        agui.sawTextDelta,
        `AG-UI stream carried no non-empty TEXT_MESSAGE_CONTENT delta ${diag}`,
      ).toBe(true);
    }

    expect(result.gotResponse, "No assistant response received").toBe(true);
    if (starter.expectedChatUiText) {
      await expect(
        page.getByText(starter.expectedChatUiText, { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("A2UI render error:")).toHaveCount(0);
    } else {
      expect(result.responseText.length).toBeGreaterThan(0);
    }
  });

  test(`@interaction ${STARTER_SLUG} — UI interactions work`, async ({
    page,
  }) => {
    test.slow();
    const { getErrors } = setupConsoleErrorCollector(page);

    await page.goto(STARTER_URL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Remove CopilotKit web inspector overlay (blocks pointer events in dev)
    await page.evaluate(() => {
      document
        .querySelectorAll("cpk-web-inspector")
        .forEach((el) => el.remove());
    });

    if (starter.hasAppMode !== false) {
      // Starters with Chat/App mode toggle (showcase shell)
      const appBtn = page.locator('button:text-is("App")');
      await appBtn.waitFor({ state: "visible", timeout: 10_000 });
      await appBtn.click({ force: true });
      await page.waitForTimeout(1_000);
      await expect(page.locator("text=No todos yet").first()).toBeVisible({
        timeout: 10_000,
      });

      // Switch back to Chat mode — verify textarea reappears
      const chatBtn = page.locator('button:text-is("Chat")');
      await chatBtn.click({ force: true });
      await page.waitForTimeout(1_000);
      await expect(page.locator("textarea").first()).toBeVisible({
        timeout: 10_000,
      });
    } else {
      // Starters with CopilotSidebar (no Chat/App toggle)
      // Verify the sidebar chat UI is present and interactive
      const textarea = page.locator("textarea").first();
      await textarea.waitFor({ state: "visible", timeout: 10_000 });

      // Verify the sidebar rendered with its title
      await expect(page.locator("text=Popup Assistant").first()).toBeVisible({
        timeout: 10_000,
      });
    }

    // Verify no JS errors throughout
    const errors = getErrors().filter(
      (e) =>
        !e.includes("favicon.ico") && !e.includes("net::ERR_BLOCKED_BY_CLIENT"),
    );
    expect(errors, `JS console errors:\n${errors.join("\n")}`).toHaveLength(0);
  });
});
