import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the readonly-state-agent-context demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Readonly State + Agent Context — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("Recall pref canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Recall pref/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
