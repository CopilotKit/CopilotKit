import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat A2UI dynamic schema", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Sales Dashboard pill renders dashboard metrics and charts", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await clickBeautifulChatPill(page, "Sales Dashboard (A2UI Dynamic)");

    await expect(page.getByText(/Total Revenue/i).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText("$1.2M").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator(".recharts-responsive-container").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
  });
});
