import { test, expect } from "@playwright/test";

test.describe("Agentic Chat (Reasoning)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
  });

  test("chat UI renders on load", async ({ page }) => {
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  test("reasoning block surfaces after sending a prompt", async ({ page }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill("Why is the sky blue? Think step by step.");
    await input.press("Enter");

    // Custom ReasoningBlock renders with this testid.
    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });

  // Canonical e2e suggestion — the page wires a single "Show reasoning"
  // pill via useConfigureSuggestions (see _canonical-catalog.json).
  // Clicking it must fire the canonical prompt and surface the
  // reasoning-block, exercising the same fixture as the typed-prompt path.
  test("canonical suggestion pill fires the reasoning prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
