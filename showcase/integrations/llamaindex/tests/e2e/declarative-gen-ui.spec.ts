import { test, expect } from "@playwright/test";

test.describe("Declarative Generative UI (A2UI — Dynamic Schema)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("requesting a KPI dashboard yields a rendered A2UI surface", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Show me a quick KPI dashboard with 3-4 metrics (revenue, signups, churn).",
    );
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
