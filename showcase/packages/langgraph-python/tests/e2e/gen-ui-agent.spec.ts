import { test, expect } from "@playwright/test";

test.describe("Agentic Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-agent");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("message list container exists", async ({ page }) => {
    // The custom messageView renders a container with data-testid
    await expect(
      page.locator('[data-testid="copilot-message-list"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test("complex task triggers task progress tracker", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Create a comprehensive dashboard showing sales metrics, revenue trends, and customer segments",
    );
    await input.press("Enter");

    // The TaskProgress component should appear when the agent reports steps
    const taskProgress = page.locator('[data-testid="task-progress"]');
    await expect(taskProgress).toBeVisible({ timeout: 60000 });

    // Should show a "Task Progress" heading
    await expect(taskProgress.getByText("Task Progress")).toBeVisible();

    // Should show a completion counter like "X/Y Complete"
    await expect(taskProgress.getByText(/\d+\/\d+\s*Complete/)).toBeVisible();

    // Step descriptions should be visible
    const stepTexts = page.locator('[data-testid="task-step-text"]');
    await expect(stepTexts.first()).toBeVisible({ timeout: 5000 });
  });

  test("task progress shows progress bar", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Build a report analyzing quarterly performance data");
    await input.press("Enter");

    const taskProgress = page.locator('[data-testid="task-progress"]');
    await expect(taskProgress).toBeVisible({ timeout: 60000 });

    // The progress bar is a rounded-full div inside the tracker
    const progressBar = taskProgress.locator(".rounded-full").first();
    await expect(progressBar).toBeVisible();
  });
});
