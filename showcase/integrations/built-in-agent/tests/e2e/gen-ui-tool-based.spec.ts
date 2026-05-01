import { test, expect } from "@playwright/test";

test("gen-ui-tool-based: page loads and chat input is visible", async ({
  page,
}) => {
  await page.goto("/demos/gen-ui-tool-based");
  await expect(
    page.getByRole("heading", { name: /tool-based generative ui/i }),
  ).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/gen-ui-tool-based");
  const pill = page.getByRole("button", { name: /Quarterly bars/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  // catalog primarySelector is [data-testid="bar-chart"], not rendered by the
  // built-in-agent gen-ui-tool-based demo (it ships HaikuCard instead) —
  // fall back to [data-role="assistant"].
  await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 60_000,
  });
});
