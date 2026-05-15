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
