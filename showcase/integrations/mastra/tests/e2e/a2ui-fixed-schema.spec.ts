import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed Schema", () => {
  test("chat surface + flight suggestion renders", async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByText(/Find SFO/).first()).toBeVisible();
  });
});
