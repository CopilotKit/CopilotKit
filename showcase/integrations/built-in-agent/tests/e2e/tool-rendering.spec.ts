import { test, expect } from "@playwright/test";

test("tool-rendering: page loads and chat input is visible", async ({
  page,
}) => {
  await page.goto("/demos/tool-rendering");
  await expect(
    page.getByRole("heading", { name: /tool rendering/i }),
  ).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible({
    timeout: 15_000,
  });
});
