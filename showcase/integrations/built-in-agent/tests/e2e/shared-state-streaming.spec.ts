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
