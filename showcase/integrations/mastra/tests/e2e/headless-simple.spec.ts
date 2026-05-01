import { test, expect } from "@playwright/test";

test.describe("Headless Simple", () => {
  test("custom textarea renders", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(
      page.getByRole("heading", { name: /Headless Chat/i }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  // Headless-simple uses a textarea — pill UX is not present. Type the
  // canonical catalog message and verify the assistant message renders.
  test("canonical catalog message in textarea renders an assistant message", async ({
    page,
  }) => {
    await page.goto("/demos/headless-simple");
    const input = page.getByRole("textbox");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill("show a small card body about hummingbirds");
    await input.press("Enter");
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
