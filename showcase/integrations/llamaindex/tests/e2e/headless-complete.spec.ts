import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test("page loads with hand-rolled header and input", async ({ page }) => {
    await page.goto("/demos/headless-complete");
    await expect(page.getByText("Headless Chat (Complete)")).toBeVisible();
    await expect(page.getByPlaceholder("Type a message...")).toBeVisible();
  });

  test("canonical 'Custom message' prompt populates the headless transcript via textarea fill", async ({
    page,
  }) => {
    // Headless demo doesn't render suggestion pills (custom textarea), so the
    // canonical message is exercised via textarea fill — see
    // showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/headless-complete");
    const textarea = page.getByPlaceholder("Type a message...");
    await expect(textarea).toBeVisible();
    await textarea.fill(
      "send a sample message to populate the headless transcript",
    );
    await textarea.press("Enter");

    // Custom message-list renders user/assistant rows; assert any message row
    // becomes visible after the textarea-driven send.
    await expect(
      page.locator("[data-message-role], [data-role]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
