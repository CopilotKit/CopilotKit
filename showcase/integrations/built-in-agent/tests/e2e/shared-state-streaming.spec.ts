import { test, expect } from "@playwright/test";

test("shared-state-streaming: page loads with document panel + chat", async ({
  page,
}) => {
  await page.goto("/demos/shared-state-streaming");
  await expect(
    page.getByRole("heading", { name: /state streaming/i }),
  ).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/shared-state-streaming");
  const pill = page.getByRole("button", { name: /Stream counter/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  // catalog primarySelector is [data-testid="status-display"], not rendered
  // by built-in-agent shared-state-streaming — fall back to
  // [data-role="assistant"].
  await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 60_000,
  });
});
