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
