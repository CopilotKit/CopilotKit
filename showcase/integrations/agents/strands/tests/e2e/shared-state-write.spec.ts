import { test, expect } from "@playwright/test";

test.describe("Shared State (Writing)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-write");
  });

  test("page loads with Sales Pipeline dashboard", async ({ page }) => {
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 10000,
    });
  });

  test("sidebar is open with Sales Pipeline Assistant title", async ({
    page,
  }) => {
    await expect(page.getByText("Sales Pipeline Assistant")).toBeVisible({
      timeout: 10000,
    });
  });

  test("dashboard shows pipeline summary with Total Pipeline metric", async ({
    page,
  }) => {
    await expect(page.getByText("Total Pipeline")).toBeVisible({
      timeout: 10000,
    });
  });

  test("can send message through sidebar and get response", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Add a new deal for Acme Corp worth $50,000");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("deal list shows empty state or active deals with interactive elements", async ({
    page,
  }) => {
    // Dashboard should show either deals or the empty state with an "Add a deal" button
    const addButton = page.getByRole("button", { name: /add a deal/i });
    const activeDealsList = page.getByText("Active Deals");

    await expect(addButton.or(activeDealsList).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("agent can modify dashboard state through chat", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill(
      "Create three sample deals: Widget Co for $10,000, Gadget Inc for $25,000, and Tech LLC for $50,000",
    );
    await input.press("Enter");

    // Wait for agent to respond
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });

    // After the agent writes state, the dashboard should reflect deals
    // Either "Active Deals" heading appears or the pipeline values change
    await expect(
      page.getByText("Active Deals").or(page.getByText(/\$\d{1,3}(,\d{3})*/)),
    ).toBeVisible({ timeout: 30000 });
  });

  test("can add a deal via UI button", async ({ page }) => {
    // Look for an "Add" or "+" button on the dashboard
    const addBtn = page.locator('button:has-text("Add"), button:has-text("+")');
    await expect(addBtn.first()).toBeVisible({ timeout: 5000 });
    const initialCount = await page
      .locator('[data-testid="todo-card"], .todo-card')
      .count();
    await addBtn.first().click();
    // New item should appear
    await expect(
      page.locator('[data-testid="todo-card"], .todo-card'),
    ).toHaveCount(initialCount + 1, { timeout: 5000 });
  });

  test("can toggle a deal completion via checkbox", async ({ page }) => {
    // First create some deals via chat so checkboxes exist
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Add a deal for Demo Corp worth $20,000");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });

    const toggleBtn = page.locator('[data-testid="toggle-completed"]').first();
    await expect(toggleBtn).toBeVisible({ timeout: 5000 });

    // The toggle is a styled button, not a native checkbox.
    // Check whether the card has the completed opacity class before/after click.
    const card = page.locator('[data-testid="todo-card"]').first();
    const hadOpacity = await card.evaluate((el) =>
      el.classList.contains("opacity-60"),
    );
    await toggleBtn.click();
    if (hadOpacity) {
      await expect(card).not.toHaveClass(/opacity-60/, { timeout: 3000 });
    } else {
      await expect(card).toHaveClass(/opacity-60/, { timeout: 3000 });
    }
  });
});
