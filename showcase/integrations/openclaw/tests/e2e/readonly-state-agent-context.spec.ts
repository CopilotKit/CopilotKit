import { test, expect } from "@playwright/test";

// Behavioral e2e for the readonly-state-agent-context demo, run against aimock
// (deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so these
// prompts match the fixtures in showcase/aimock/d4/openclaw/chat.json. The demo
// publishes read-only UI state (name / timezone / activity) to the agent via
// useAgentContext; the fixture responses reference the DEFAULT state values.
test.describe("Readonly State: Agent Context", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("page loads with the context card and default state", async ({
    page,
  }) => {
    await expect(page.getByTestId("context-card")).toBeVisible({
      timeout: 20000,
    });
    // Default identity broadcast to the agent.
    await expect(page.getByTestId("ctx-name")).toHaveValue("Atai", {
      timeout: 15000,
    });
    await expect(page.getByTestId("identity-name")).toHaveText("Atai");
  });

  test("page loads with a chat input and the three starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Ask about your context...")).toBeVisible({
      timeout: 20000,
    });
    for (const title of [
      "Who am I?",
      "What timezone am I in?",
      "Summarize my activity",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("agent answers with the user's name from context", async ({ page }) => {
    const input = page.getByPlaceholder("Ask about your context...");
    await input.fill("What is my name according to my context?");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Atai/i).last()).toBeVisible({
      timeout: 30000,
    });
  });

  test("agent answers with the user's timezone from context", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Ask about your context...");
    await input.fill("What timezone am I in?");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Los_Angeles/i).last()).toBeVisible({
      timeout: 30000,
    });
  });
});
