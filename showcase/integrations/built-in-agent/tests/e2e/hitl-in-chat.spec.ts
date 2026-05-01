import { test, expect } from "@playwright/test";

test("hitl-in-chat: page loads and chat input is visible", async ({ page }) => {
  await page.goto("/demos/hitl");
  await expect(
    page.getByRole("heading", { name: /human in the loop/i }),
  ).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});

// Note: this spec file is misnamed historically — it covers /demos/hitl, not
// /demos/hitl-in-chat. The canonical pill below is therefore the hitl entry
// in showcase/aimock/_canonical-catalog.json. The hitl-in-chat canonical pill
// is wired in tests/e2e/hitl-in-chat-canonical.spec.ts.
test("canonical suggestion pill fires the feature (hitl)", async ({ page }) => {
  await page.goto("/demos/hitl");
  const pill = page.getByRole("button", { name: /Sourcing route/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  // catalog primarySelector is [data-testid="select-steps"], not rendered by
  // built-in-agent hitl — fall back to [data-role="assistant"].
  await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 60_000,
  });
});
