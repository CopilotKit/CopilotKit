import { test, expect } from "@playwright/test";

test.describe("Declarative Generative UI (A2UI Dynamic)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
  });

  test("chat UI renders", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
