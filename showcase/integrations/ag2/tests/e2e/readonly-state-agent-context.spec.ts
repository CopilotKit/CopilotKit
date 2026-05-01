import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test("context card renders with name/timezone inputs", async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-timezone"]')).toBeVisible();
  });

  // Canonical e2e suggestion — single "Recall pref" pill from
  // _canonical-catalog.json. Selector falls back to [data-role="assistant"]
  // (ag2 spec convention) instead of the catalog's copilot-suggestion.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/readonly-state-agent-context");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Recall pref" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });
  });
});
