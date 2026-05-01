import { test, expect } from "@playwright/test";

test.describe("Agent Config", () => {
  test("page loads with config controls and chat", async ({ page }) => {
    await page.goto("/demos/agent-config");
    await expect(page.getByTestId("agent-config-card")).toBeVisible();
    await expect(page.getByTestId("agent-config-tone-select")).toBeVisible();
    await expect(
      page.getByTestId("agent-config-expertise-select"),
    ).toBeVisible();
    await expect(page.getByTestId("agent-config-length-select")).toBeVisible();
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Personalize tone/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator("[data-testid=\"agent-config-card\"]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
