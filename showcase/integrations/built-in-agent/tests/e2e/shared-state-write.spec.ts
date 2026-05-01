import { test, expect } from "@playwright/test";

// Counterpart to `shared-state-read.spec.ts`. The single demo page exercises
// both read and write paths; this spec asserts the write surface — the
// editable recipe-title input + chat input that drive `agent.state` mutation.
test("shared-state-write: editable inputs allow user to mutate agent state", async ({
  page,
}) => {
  await page.goto("/demos/shared-state-read-write");
  await expect(
    page.getByRole("heading", { name: /shared state/i }),
  ).toBeVisible();
  // Recipe title input + chat input — both are textboxes and represent the
  // two write paths into agent state.
  await expect(page.getByRole("textbox")).toHaveCount(2, { timeout: 15_000 });
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/shared-state-read-write");
  const pill = page.getByRole("button", { name: /Weekend plan/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
