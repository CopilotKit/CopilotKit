import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for agentic-chat-reasoning.
test.describe("Agentic Chat (Reasoning) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
  });

  test("Show reasoning suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("show your reasoning step by step"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
