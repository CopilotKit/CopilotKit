import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for gen-ui-interrupt — the demo wires a
// single canonical pill from showcase/aimock/_canonical-catalog.json. See the
// langgraph-python sibling spec for the full interaction flow; this strands
// spec is intentionally narrow because the Strands package reuses one shared
// backend agent across every demo.

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/gen-ui-interrupt");
  const pill = page.getByRole("button", { name: /Pause and pick/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="time-picker-card"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
