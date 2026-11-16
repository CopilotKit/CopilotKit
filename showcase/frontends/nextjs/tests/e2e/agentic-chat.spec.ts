import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Agentic Chat is the smallest CopilotChat demo: a page with `<CopilotChat>`
// and three starter suggestions. These tests check that a plain chat works
// end to end. Richer chat features have their own demos (frontend-tools,
// tool-rendering and more).
const STARTER_SUGGESTIONS = [
  "Write a sonnet",
  "Tell me a joke",
  "Is 17 prime?",
];

function assistantMessages(page: Page) {
  return page.locator('[data-testid="copilot-assistant-message"]');
}

describeDemo("agentic-chat", "Agentic Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("agentic-chat"));
  });

  test("page loads with chat input and the three starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    for (const title of STARTER_SUGGESTIONS) {
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

    await expect(assistantMessages(page).first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("clicking a suggestion pill sends the message and gets a response", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Tell me a joke" }).click();

    await expect(assistantMessages(page).first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("multi-turn conversation maintains context", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    const responses = assistantMessages(page);

    await input.fill("My name is Alice.");
    await input.press("Enter");
    await expect(responses.first()).toBeVisible({ timeout: 30000 });

    // Wait for the chat to settle (suggestions reappear after the assistant
    // finishes streaming) before sending the follow-up message.
    await expect(
      page.getByRole("button", { name: "Write a sonnet" }),
    ).toBeVisible({ timeout: 10000 });

    await input.fill("What name did I just give you?");
    await input.press("Enter");

    await expect(responses.nth(1)).toBeVisible({ timeout: 30000 });
    await expect(responses.nth(1)).toContainText(/Alice/i, { timeout: 5000 });
  });
});
