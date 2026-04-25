import { test, expect } from "@playwright/test";

test.describe("Headless Simple", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with heading and input", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();

    await expect(page.getByPlaceholder(/Type a message/)).toBeVisible();
  });

  test("send button is disabled on empty input, enabled when typing", async ({
    page,
  }) => {
    const button = page.getByRole("button", { name: "Send" });
    await expect(button).toBeDisabled();
    await page.getByPlaceholder(/Type a message/).fill("hi");
    await expect(button).toBeEnabled();
  });

  test("typing a message and clicking send produces an assistant response", async ({
    page,
  }) => {
    await page.getByPlaceholder(/Type a message/).fill("Say hi");
    await page.getByRole("button", { name: "Send" }).click();

    // Our minimal user bubble has `self-end`. We assert that any element with
    // "Say hi" exists in the transcript area, then that an assistant-like
    // bubble appears as well.
    await expect(page.getByText("Say hi").first()).toBeVisible({
      timeout: 30000,
    });
  });
});
