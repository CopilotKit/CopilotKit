import { test, expect } from "@playwright/test";

test.describe("Agent Config", () => {
  test("config card renders", async ({ page }) => {
    await page.goto("/demos/agent-config");
    await expect(
      page.getByRole("heading", { name: /Agent Config/i }),
    ).toBeVisible();
  });
});
