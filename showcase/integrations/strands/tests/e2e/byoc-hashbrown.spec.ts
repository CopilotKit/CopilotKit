import { test, expect } from "@playwright/test";

test("byoc-hashbrown loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/demos/byoc-hashbrown");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByText("BYOC: Hashbrown")).toBeVisible();

  expect(
    errors,
    `page errors on /demos/byoc-hashbrown: ${errors.join(" | ")}`,
  ).toEqual([]);
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/byoc-hashbrown");
  const pill = page.getByRole("button", { name: /Sales overview/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(page.locator('[data-testid="metric-card"]').first()).toBeVisible(
    { timeout: 60_000 },
  );
});
