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
