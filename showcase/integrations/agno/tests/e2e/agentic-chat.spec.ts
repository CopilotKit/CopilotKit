import { test, expect } from "@playwright/test";

// Agentic Chat is the minimum-viable CopilotChat demo: a tiny page
// that wraps `<CopilotChat>` plus three starter-prompt suggestions. The
// contract here is "vanilla chat works end-to-end" — anything richer
// belongs in dedicated demos (frontend-tools, tool-rendering, etc.).
test.describe("Agentic Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat");
  });

  test("page loads with chat input and the three starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    for (const title of ["Write a sonnet", "Tell me a joke", "Is 17 prime?"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("sends a typed message and gets an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Say hello in one word.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("clicking a suggestion pill sends the message and gets a response", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Tell me a joke" }).click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("multi-turn conversation maintains context", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");

    await input.fill("My name is Alice.");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });

    // Wait for the chat to settle (suggestions reappear after the assistant
    // finishes streaming) before sending the follow-up message.
    await expect(
      page.getByRole("button", { name: "Write a sonnet" }),
    ).toBeVisible({ timeout: 10000 });

    await input.fill("What name did I just give you?");
    await input.press("Enter");

    const responses = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(responses.nth(1)).toBeVisible({ timeout: 30000 });
    await expect(responses.nth(1)).toContainText(/Alice/i, { timeout: 5000 });
  });
});
