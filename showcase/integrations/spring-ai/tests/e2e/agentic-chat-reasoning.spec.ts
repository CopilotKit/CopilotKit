import { test, expect } from "@playwright/test";

test.describe("Agentic Chat (Reasoning)", () => {
  test("page loads with chat", async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Show reasoning/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator("[data-testid=\"reasoning-block\"]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
