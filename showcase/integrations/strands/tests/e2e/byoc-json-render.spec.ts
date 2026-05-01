import { test, expect } from "@playwright/test";

test("byoc-json-render loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/demos/byoc-json-render");
  await page.waitForLoadState("domcontentloaded");

  expect(
    errors,
    `page errors on /demos/byoc-json-render: ${errors.join(" | ")}`,
  ).toEqual([]);
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/byoc-json-render");
  const pill = page
    .getByRole("button", { name: /Marketing overview/i })
    .first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="json-render-root"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
