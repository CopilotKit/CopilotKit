import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Browser Use: a Mastra agent that drives a local headless browser.
//
// Demo: src/app/demos/[integration]/browser-use/
// Manual QA: showcase/integrations/mastra/qa/browser-use.md
//
// Why this demo has no aimock replay fixture: it needs a real LLM. The agent
// drives a live local headless browser (Playwright Chromium) through the
// `browse_web` tool. Browser navigation is not deterministic, because the top
// Hacker News stories and the content of any page change on every request.
// So there is nothing stable to record and replay. A real browse in CI would
// also need a real OpenAI key, live network access and the Chromium binary
// (`npx playwright install chromium`).
//
// So this spec is a smoke test only. It checks that the page loads, that the
// suggestion pills render and that the chat input is enabled. It sends no
// message and starts no browse. The full browse flow is a manual QA step with
// a real LLM.

describeDemo("browser-use", "Browser Use (Mastra, local browser)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("browser-use"));
  });

  test("page loads with an enabled chat input", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    // No results card exists before a browse.
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
