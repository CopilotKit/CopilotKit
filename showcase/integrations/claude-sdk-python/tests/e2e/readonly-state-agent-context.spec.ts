import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("page loads with context card", async ({ page }) => {
    await expect(page.getByTestId("context-card")).toBeVisible();
  });

  test("context controls are editable", async ({ page }) => {
    await expect(page.getByTestId("ctx-name")).toBeVisible();
    await expect(page.getByTestId("ctx-timezone")).toBeVisible();
  });

  test("Recall pref suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Recall pref/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
