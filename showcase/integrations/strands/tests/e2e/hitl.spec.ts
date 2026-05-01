import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for hitl — the demo wires a single
// canonical pill from showcase/aimock/_canonical-catalog.json. See the
// langgraph-python sibling spec for the full interaction flow.

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/hitl");
  const pill = page.getByRole("button", { name: /Sourcing route/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="select-steps"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
