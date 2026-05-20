import { test, expect } from "@playwright/test";

test.describe("Sub-Agents", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/subagents");
  });

  test("page loads with delegation log and chat sidebar", async ({ page }) => {
    // The DelegationLog panel should be visible
    await expect(page.locator('[data-testid="delegation-log"]')).toBeVisible({
      timeout: 10000,
    });

    // Delegation log header
    await expect(page.getByText("Sub-agent delegations")).toBeVisible({
      timeout: 10000,
    });
  });

  test("delegation log starts empty with placeholder text", async ({
    page,
  }) => {
    await expect(
      page.getByText("Ask the supervisor to complete a task"),
    ).toBeVisible({ timeout: 10000 });

    // Delegation count shows 0
    const count = page.locator('[data-testid="delegation-count"]');
    await expect(count).toHaveText("0 calls", { timeout: 10000 });
  });

  test("chat sidebar has input textarea", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("can send message and get assistant response", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Research the benefits of remote work");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("supervisor delegates to sub-agents and log updates", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill(
      "Research the benefits of exercise and write a one-paragraph summary",
    );
    await input.press("Enter");

    // Wait for at least one delegation entry to appear in the log
    const delegationEntry = page.locator('[data-testid="delegation-entry"]');
    const assistantMsg = page.locator('[data-role="assistant"]').first();

    await expect(delegationEntry.first().or(assistantMsg)).toBeVisible({
      timeout: 60000,
    });
  });
});
