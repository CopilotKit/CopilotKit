import { test, expect } from "@playwright/test";

test.describe("Interrupt Headless (testing)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("page renders without errors", async ({ page }) => {
    // App surface container is the most stable structural element —
    // it renders immediately on mount, independent of agent state.
    await expect(
      page.getByTestId("interrupt-headless-app-surface"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Scheduling" }),
    ).toBeVisible();
  });
});
