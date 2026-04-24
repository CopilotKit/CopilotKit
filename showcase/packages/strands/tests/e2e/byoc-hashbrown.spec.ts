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
