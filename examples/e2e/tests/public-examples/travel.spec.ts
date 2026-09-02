import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("travel", () => {
  test.skip(EXAMPLE !== "travel", `EXAMPLE=${EXAMPLE}`);

  test("loads", async ({ page }) => {
    await page.goto("/?copilotOpen=false");
    await expect(page).toHaveTitle(/CopilotKit Travel/i);
  });
});
