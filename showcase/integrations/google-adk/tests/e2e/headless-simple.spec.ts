import { test, expect } from "@playwright/test";

// Headless demos do not render suggestion pills — the catalog message is
// typed into the textarea directly. Message must match
// showcase/aimock/_canonical-catalog.json (frozen) for headless-simple.
const CANONICAL_MESSAGE = "show a small card body about hummingbirds";

test.describe("Headless Chat (Simple) — canonical textarea fill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("typing the catalog message into the textarea sends it", async ({
    page,
  }) => {
    const textarea = page.getByPlaceholder(/Type a message/i);
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill(CANONICAL_MESSAGE);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The user bubble (data-message-role="user") shows the verbatim text.
    await expect(page.getByText(CANONICAL_MESSAGE)).toBeVisible({
      timeout: 30_000,
    });
    await expect(textarea).toHaveValue("", { timeout: 10_000 });
  });
});
