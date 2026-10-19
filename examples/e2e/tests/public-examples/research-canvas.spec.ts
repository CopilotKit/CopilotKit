import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("research-canvas", () => {
  test.skip(EXAMPLE !== "research-canvas", `EXAMPLE=${EXAMPLE}`);

  test("loads", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Research Helper" }),
    ).toBeVisible();
  });
});
