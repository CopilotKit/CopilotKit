import { test, expect } from "@playwright/test";

// QA reference: qa/browser-use.md
// Demo source: src/app/demos/browser-use/{page.tsx, chat.tsx, browse-results-card.tsx}
// Backend: src/mastra/agents/index.ts (browserUseAgent) + src/mastra/tools/browse-web.ts
// Route: src/app/api/copilotkit-browser-use/route.ts
//
// WHY THERE IS NO AIMOCK REPLAY / D6 FIXTURE FOR THIS CELL
// -------------------------------------------------------
// This is a Mastra-only, REAL-LLM demo. The agent drives a live LOCAL
// headless browser (Playwright Chromium) via the `browse_web` tool. Browser
// navigation is inherently NON-DETERMINISTIC: the top Hacker News stories and
// the contents of any page change on every request, so there is nothing
// stable to record-and-replay under aimock. Driving a real browse in CI would
// additionally require a real OpenAI key, live network access, and the
// Chromium binary (`npx playwright install chromium`).
//
// Therefore this spec is a lightweight SMOKE test only: it asserts the page
// loads, the suggestion pills render, and the chat input is enabled. It does
// NOT send a message or trigger a real browse. Exercising the full browse
// flow is a manual / real-LLM QA step documented in qa/browser-use.md.

test.describe("Browser Use (Mastra, local browser)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/browser-use");
  });

  test("page loads with an enabled chat input", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    // No results card should exist before any browse happens.
    await expect(page.getByTestId("browse-results-card")).toHaveCount(0);
  });

  test("suggestion pills render", async ({ page }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "top Hacker News stories" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestions.filter({ hasText: "CopilotKit homepage" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
