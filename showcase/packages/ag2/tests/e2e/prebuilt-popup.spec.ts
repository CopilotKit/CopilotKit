import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test("page loads with popup launcher and main content visible", async ({
    page,
  }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByText("Popup demo — look for the floating launcher"),
    ).toBeVisible();
  });
});
