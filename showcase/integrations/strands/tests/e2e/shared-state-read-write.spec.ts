import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for shared-state-read-write — the demo
// wires a single canonical pill from showcase/aimock/_canonical-catalog.json.
// See the langgraph-python sibling spec for the full interaction flow.

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/shared-state-read-write");
  const pill = page.getByRole("button", { name: /Weekend plan/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
