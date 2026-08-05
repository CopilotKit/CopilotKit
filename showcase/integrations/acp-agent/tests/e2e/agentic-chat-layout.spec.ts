import { expect, test } from "@playwright/test";

test("agentic chat renders its input and starter suggestions", async ({
  page,
}) => {
  await page.goto("/demos/agentic-chat");

  await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  for (const title of ["Write a sonnet", "Tell me a joke", "Is 17 prime?"]) {
    await expect(page.getByRole("button", { name: title })).toBeVisible({
      timeout: 15_000,
    });
  }
});
