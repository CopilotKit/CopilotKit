import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("state-machine", () => {
  test.skip(EXAMPLE !== "state-machine", `EXAMPLE=${EXAMPLE}`);

  test("loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Orders" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "State Visualizer" }),
    ).toBeVisible();
  });
});
