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

  test("canonical 'Show card' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    const pill = page.getByRole("button", { name: /Show card/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
