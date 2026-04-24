import { test, expect } from "@playwright/test";

test.describe("Headless Simple", () => {
  test("custom textarea renders", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(
      page.getByRole("heading", { name: /Headless Chat/i }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});
