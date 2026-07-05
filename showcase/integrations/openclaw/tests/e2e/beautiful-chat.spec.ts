import { test, expect } from "@playwright/test";

// Behavioral e2e for the beautiful-chat demo, run against aimock (deterministic
// LLM). The gateway injects X-AIMock-Context: openclaw, so these prompts match
// the fixtures in showcase/aimock/d4/openclaw/chat.json.
test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
  });

  test("page loads with a chat input and the starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of ["Write a sonnet", "Explain an API", "Fun fact"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("shows the Chat / App mode toggle", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "Chat", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "App", exact: true }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("sends a typed message and gets an assistant response", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Explain what an API is.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Application Programming Interface/i)).toBeVisible({
      timeout: 30000,
    });
  });

  test("clicking a suggestion pill sends it and gets a response", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Fun fact" }).click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/honey never spoils/i)).toBeVisible({
      timeout: 30000,
    });
  });

  test("switching to App mode reveals the todo canvas", async ({ page }) => {
    await page.getByRole("button", { name: "App", exact: true }).click();

    // The empty todo canvas prompts the user to create their first task.
    await expect(
      page.getByRole("button", { name: "Add a task" }),
    ).toBeVisible({ timeout: 20000 });
  });
});
