import { test, expect } from "@playwright/test";

test.describe("Prebuilt Popup", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByRole("heading", {
        name: "Popup demo — look for the floating launcher",
      }),
    ).toBeVisible();
  });
});
