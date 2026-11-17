import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/gen-ui-tool-based/page.tsx
//
// A centered <CopilotChat> with two `useComponent` registrations
// (render_bar_chart and render_pie_chart) and three suggestion pills from
// `useConfigureSuggestions`. The demo has no header: the chat is the page.

function chatInput(page: Page) {
  return page.locator('textarea, [placeholder*="message"]').first();
}

function firstAssistantMessage(page: Page) {
  return page.locator('[data-testid="copilot-assistant-message"]').first();
}

async function sendMessage(page: Page, text: string) {
  const input = chatInput(page);
  await input.fill(text);
  await input.press("Enter");
}

describeDemo("gen-ui-tool-based", "Tool-Based Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("gen-ui-tool-based"));
  });

  test("page loads with chat composer and the three suggestion pills", async ({
    page,
  }) => {
    await expect(chatInput(page)).toBeVisible({ timeout: 10000 });

    for (const title of [
      "Sales bar chart",
      "Traffic pie chart",
      "Market share",
    ]) {
      await expect(
        page
          .locator('[data-testid="copilot-suggestion"]')
          .filter({ hasText: title }),
      ).toBeVisible({ timeout: 15000 });
    }
  });

  test("pie chart request renders SVG visualization", async ({ page }) => {
    await sendMessage(page, "Show me a pie chart of revenue by category");

    // The chart renders as SVG inside the assistant message.
    await expect(
      firstAssistantMessage(page).locator("svg").first(),
    ).toBeVisible({ timeout: 60000 });
  });

  test("bar chart request renders SVG visualization", async ({ page }) => {
    await sendMessage(page, "Show me a bar chart of monthly expenses");

    await expect(
      firstAssistantMessage(page).locator("svg").first(),
    ).toBeVisible({ timeout: 60000 });
  });

  test("sends message and gets assistant response", async ({ page }) => {
    await sendMessage(page, "Hello");

    await expect(firstAssistantMessage(page)).toBeVisible({ timeout: 30000 });
  });
});
