import { test, expect } from "@playwright/test";

// QA reference: qa/readonly-state-agent-context.md
// Demo source: src/app/demos/readonly-state-agent-context/page.tsx
//
// The demo publishes three frontend-only values to the agent via
// `useAgentContext`: `userName` (default "Atai"), `userTimezone`
// (default "America/Los_Angeles"), and `recentActivity` (defaults to
// ACTIVITIES[0] "Viewed the pricing page" + ACTIVITIES[2] "Watched the
// product demo video"). Suggestion pills render verbatim message bodies:
//   - "Who am I?" → "What do you know about me from my context?"
//   - "Suggest next steps" → "Based on my recent activity, what should I try next?"
// Both prompts are pinned to deterministic aimock fixtures (see
// showcase/aimock/d5-all.json) so the assistant's leading phrase is
// stable in CI. On Railway, the same prompts produce a real LLM reply
// that mentions the published context fields — proving end-to-end
// `useAgentContext` wiring.

test.describe("Readonly Agent Context (useAgentContext)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("page loads: context-card + composer render", async ({ page }) => {
    await expect(page.getByTestId("context-card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByPlaceholder("Ask about your context..."),
    ).toBeVisible();
  });

  test("editing name + timezone updates the published JSON preview", async ({
    page,
  }) => {
    const json = page.getByTestId("ctx-state-json");

    // Edit name → "Jamie".
    await page.getByTestId("ctx-name").fill("Jamie");
    await expect(json).toContainText('"name": "Jamie"');

    // Change timezone via <select>.
    await page.getByTestId("ctx-timezone").selectOption("Asia/Tokyo");
    await expect(json).toContainText('"timezone": "Asia/Tokyo"');
  });

  test('"Who am I?" pill — assistant acknowledges identity + identity card matches defaults', async ({
    page,
  }) => {
    // Identity card shows the defaults BEFORE we click the pill — these
    // assertions don't depend on the round-trip and lock the testids.
    await expect(page.getByTestId("identity-name")).toHaveText("Atai");
    await expect(page.getByTestId("identity-timezone")).toHaveText(
      "America/Los_Angeles",
    );
    await expect(page.getByTestId("identity-avatar")).toHaveText("A");

    const suggestion = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Who am I?" });
    await expect(suggestion.first()).toBeVisible({ timeout: 15_000 });
    await suggestion.first().click();

    // Aimock fixture for the verbatim pill prompt
    // ("What do you know about me from my context?") returns a content reply
    // beginning with "I see you're Atai".
    const assistant = page.locator(
      '[data-message-role="assistant"], [data-role="assistant"]',
    );
    await expect(
      assistant.filter({ hasText: "I see you're Atai" }).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("activity checkboxes default-checked: pricing page + product demo video", async ({
    page,
  }) => {
    // ACTIVITIES[0] and ACTIVITIES[2] are the default-selected entries in
    // page.tsx. Their <label> testids embed the kebab-cased activity name.
    const pricingLabel = page.getByTestId("activity-viewed-the-pricing-page");
    const demoLabel = page.getByTestId(
      "activity-watched-the-product-demo-video",
    );
    await expect(pricingLabel).toBeVisible();
    await expect(demoLabel).toBeVisible();

    // Each <label> wraps a <Checkbox> whose `checked` prop reflects
    // selection. Assert the underlying input is checked.
    await expect(pricingLabel.locator('input[type="checkbox"]')).toBeChecked();
    await expect(demoLabel.locator('input[type="checkbox"]')).toBeChecked();
  });

  test('"Suggest next steps" pill — assistant grounds reply in default activities', async ({
    page,
  }) => {
    const suggestion = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Suggest next steps" });
    await expect(suggestion.first()).toBeVisible({ timeout: 15_000 });
    await suggestion.first().click();

    // Aimock fixture for the verbatim pill prompt
    // ("Based on my recent activity, what should I try next?") returns a
    // content reply beginning with "Since you recently viewed the pricing
    // page and watched the product demo video".
    const assistant = page.locator(
      '[data-message-role="assistant"], [data-role="assistant"]',
    );
    await expect(
      assistant
        .filter({
          hasText:
            "Since you recently viewed the pricing page and watched the product demo video",
        })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
