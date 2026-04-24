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
