import { test, expect } from "@playwright/test";

test("gen-ui-agent: page loads with plan panel + chat", async ({ page }) => {
  await page.goto("/demos/gen-ui-agent");
  await expect(
    page.getByRole("heading", { name: /agentic generative ui/i }),
  ).toBeVisible();
  await expect(page.getByText(/no plan yet/i)).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/gen-ui-agent");
  const pill = page.getByRole("button", { name: /Launch outline/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  // catalog primarySelector is [data-testid="agent-state-card"], not rendered
  // by built-in-agent gen-ui-agent — fall back to [data-role="assistant"].
  await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 60_000,
  });
});
