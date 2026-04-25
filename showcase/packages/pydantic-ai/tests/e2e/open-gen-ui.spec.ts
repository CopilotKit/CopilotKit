import { test, expect } from "@playwright/test";

test.describe("Open Generative UI (Minimal)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("chat UI renders", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
