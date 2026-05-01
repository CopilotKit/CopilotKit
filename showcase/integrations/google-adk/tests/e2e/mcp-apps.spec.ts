import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for mcp-apps.
test.describe("MCP Apps — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/mcp-apps");
  });

  test("Excalidraw suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Excalidraw/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText(
        "draw an excalidraw diagram of a router with two switches",
      ),
    ).toBeVisible({ timeout: 30_000 });
  });
});
