import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("form-filling", () => {
  test.skip(EXAMPLE !== "form-filling", `EXAMPLE=${EXAMPLE}`);

  test("loads", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Security Incident Report" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("contentinfo")
        .filter({ hasText: /Powered by CopilotKit/i })
        .first(),
    ).toBeVisible();
  });
});
