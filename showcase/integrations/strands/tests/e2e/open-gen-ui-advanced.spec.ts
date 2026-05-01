import { test, expect } from "@playwright/test";

test("open-gen-ui-advanced loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/demos/open-gen-ui-advanced");
  await page.waitForLoadState("domcontentloaded");

  expect(
    errors,
    `page errors on /demos/open-gen-ui-advanced: ${errors.join(" | ")}`,
  ).toEqual([]);
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/open-gen-ui-advanced");
  const pill = page.getByRole("button", { name: /Advanced flow/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-suggestion"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
