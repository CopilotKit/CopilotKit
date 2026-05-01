import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test("page loads with hand-rolled textarea", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(page.getByPlaceholder(/Type a message. Ask me/)).toBeVisible();
  });

  test("canonical 'Card body' prompt populates headless-simple via textarea fill", async ({
    page,
  }) => {
    // Headless demo doesn't render suggestion pills (custom textarea), so the
    // canonical message is exercised via textarea fill — see
    // showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/headless-simple");
    const textarea = page.getByPlaceholder(/Type a message. Ask me/);
    await expect(textarea).toBeVisible();
    await textarea.fill("show a small card body about hummingbirds");
    await textarea.press("Enter");

    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
