import { test, expect } from "@playwright/test";

test.describe("MCP Apps", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/mcp-apps");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Excalidraw suggestion pill exercises the catalog message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Excalidraw" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
