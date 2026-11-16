// Each test sends two pills in one thread. The second pill's turns come
// after the first pill's turns, so the integration's fixtures must match
// each pill by its message and `hasToolResult` (a fixture keyed on
// `turnIndex` does not match a second pill). The narration lines checked
// here ("Pie chart rendered above", "Two flights shown above") are fixture
// text.
import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";
import { describeDemo } from "./helpers";

describeDemo("beautiful-chat", "Beautiful Chat fixture sequencing", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Pie Chart then Search Flights keeps FlightCard rendering stable", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await clickBeautifulChatPill(page, "Pie Chart (Controlled Generative UI)");
    await expect(
      page.getByText(/Pie chart rendered above/i).first(),
    ).toBeVisible({ timeout: 60_000 });

    await clickBeautifulChatPill(page, "Search Flights (A2UI Fixed Schema)");
    await expect(page.getByText("United Airlines").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByText(/Two flights shown above/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Search Flights then Sales Dashboard still renders dashboard UI", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    await clickBeautifulChatPill(page, "Search Flights (A2UI Fixed Schema)");
    await expect(page.getByText("United Airlines").first()).toBeVisible({
      timeout: 60_000,
    });

    await clickBeautifulChatPill(page, "Sales Dashboard (A2UI Dynamic)");
    await expect(page.getByText(/Total Revenue/i).first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText("$1.2M").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(
        async () =>
          await page.locator(".recharts-responsive-container").count(),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(2);
  });
});
