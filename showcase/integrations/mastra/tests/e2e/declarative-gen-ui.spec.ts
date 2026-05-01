import { test, expect } from "@playwright/test";

test.describe("Declarative Generative UI (A2UI — Dynamic Schema)", () => {
  test("chat surface + canonical suggestion chip renders", async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByText(/Show card/).first()).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
    const pill = page.getByRole("button", { name: /Show card/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
