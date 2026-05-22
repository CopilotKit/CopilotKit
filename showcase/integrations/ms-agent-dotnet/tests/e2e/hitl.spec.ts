import { test, expect } from "@playwright/test";

test.describe("HITL step review", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("rejecting Simple plan uses the reject branch and the pill can be run again", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.getByRole("button", { name: "Simple plan" }).click();
    await expect(
      page.getByRole("heading", { name: "Review Steps" }),
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Reject" }).click();
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: "will not execute the Mars trip plan" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Great choices!")).toHaveCount(0);

    await page.getByRole("button", { name: "Simple plan" }).click();
    await expect(page.getByRole("button", { name: "Confirm (5)" })).toBeVisible(
      { timeout: 60_000 },
    );
  });
});
