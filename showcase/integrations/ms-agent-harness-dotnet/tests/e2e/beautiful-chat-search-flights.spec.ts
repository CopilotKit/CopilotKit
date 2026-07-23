import { expect, test } from "@playwright/test";
import {
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";

test.describe("Beautiful Chat A2UI fixed schema", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("Search Flights pill renders FlightCard content", async ({ page }) => {
    test.setTimeout(120_000);

    await clickBeautifulChatPill(page, "Search Flights (A2UI Fixed Schema)");

    await expect(page.getByText("United Airlines").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Delta").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("$349").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("$289").first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
