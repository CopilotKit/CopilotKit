import { test, expect } from "@playwright/test";

// Behavioral e2e for the agentic-chat demo, run against aimock (deterministic
// LLM). The gateway injects X-AIMock-Context: openclaw, so these prompts match
// the fixtures in showcase/aimock/d4/openclaw/chat.json.
test.describe("Agentic Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat");
  });

  test("page loads with a chat input and the three starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of ["Write a sonnet", "Tell me a joke", "Is 17 prime?"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("sends a typed message and gets an assistant response", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Say hello in one word.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("clicking a suggestion pill sends it and gets a response", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Tell me a joke" }).click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/layers/i)).toBeVisible({ timeout: 30000 });
  });

  test("multi-turn conversation maintains context", async ({ page }) => {
    const input = page.getByRole("textbox").first();

    await input.fill("My name is Alice.");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });

    await input.fill("What name did I just give you?");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').nth(1),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Alice/i).last()).toBeVisible({
      timeout: 30000,
    });
  });
});
