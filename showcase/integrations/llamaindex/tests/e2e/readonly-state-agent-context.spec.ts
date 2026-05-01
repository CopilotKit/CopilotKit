import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test("page loads with context card and chat", async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(
      page.getByPlaceholder("Ask about your context..."),
    ).toBeVisible();
  });

  test("canonical 'Recall pref' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/readonly-state-agent-context");
    const pill = page.getByRole("button", { name: /Recall pref/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
