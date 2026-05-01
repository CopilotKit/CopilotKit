import { test, expect } from "@playwright/test";

test.describe("HITL in chat — booking flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-chat");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical suggestion pill renders the time-picker", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Pick a slot/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    const card = page.locator('[data-testid="time-picker-card"]');
    await expect(card.first()).toBeVisible({ timeout: 60_000 });

    // At least one selectable time slot is present.
    const slots = page.locator('[data-testid="time-picker-slot"]');
    expect(await slots.count()).toBeGreaterThan(0);
  });

  test("picking a time slot resolves the HITL with a confirmation", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Pick a slot/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    const slot = page.locator('[data-testid="time-picker-slot"]').first();
    await expect(slot).toBeVisible({ timeout: 60_000 });
    await slot.click();

    // The picked-state card replaces the slot grid.
    await expect(
      page.locator('[data-testid="time-picker-picked"]'),
    ).toBeVisible({ timeout: 10_000 });
  });
});
