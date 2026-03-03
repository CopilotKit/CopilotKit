import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("chat-with-your-data", () => {
  test.skip(EXAMPLE !== "chat-with-your-data", `EXAMPLE=${EXAMPLE}`);

  test("loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Chat with your data/i);
    await expect(
      page.getByRole("heading", { name: "Data Dashboard" }),
    ).toBeVisible();
  });
});
