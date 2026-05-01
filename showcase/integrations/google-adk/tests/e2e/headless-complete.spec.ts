import { test, expect } from "@playwright/test";

// Headless demos do not render suggestion pills — the catalog message is
// typed into the textarea directly. Message must match
// showcase/aimock/_canonical-catalog.json (frozen) for headless-complete.
const CANONICAL_MESSAGE =
  "send a sample message to populate the headless transcript";

test.describe("Headless Chat (Complete) — canonical textarea fill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("typing the catalog message into the textarea sends it", async ({
    page,
  }) => {
    const textarea = page.getByPlaceholder(/Type a message/i);
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill(CANONICAL_MESSAGE);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText(CANONICAL_MESSAGE)).toBeVisible({
      timeout: 30_000,
    });
    // Textarea clears on submit.
    await expect(textarea).toHaveValue("", { timeout: 10_000 });
  });
});
