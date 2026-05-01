import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed Schema", () => {
  test("page loads with CopilotChat", async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Block calendar/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
