import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("context card and JSON preview render", async ({ page }) => {
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-state-json"]')).toBeVisible();
  });

  test("changing the name input updates the JSON preview", async ({ page }) => {
    const name = page.locator('[data-testid="ctx-name"]');
    await name.fill("Alice");

    const json = page.locator('[data-testid="ctx-state-json"]');
    await expect(json).toContainText('"name": "Alice"');
  });

  test("changing the timezone updates the JSON preview", async ({ page }) => {
    const tz = page.locator('[data-testid="ctx-timezone"]');
    await tz.selectOption("Europe/London");

    const json = page.locator('[data-testid="ctx-state-json"]');
    await expect(json).toContainText("Europe/London");
  });

  // Canonical e2e suggestion — single "Recall pref" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and the agent (with the user's read-only context) responds.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
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
