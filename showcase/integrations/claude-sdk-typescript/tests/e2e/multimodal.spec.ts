import { test, expect } from "@playwright/test";

test.describe("Multimodal attachments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/multimodal");
  });

  test("page loads with header and sample buttons", async ({ page }) => {
    await expect(
      page.locator('[data-testid="multimodal-demo-root"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="multimodal-sample-image-button"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="multimodal-sample-pdf-button"]'),
    ).toBeVisible();
  });

  test("paperclip input is mounted under the chat root", async ({ page }) => {
    // CopilotChat mounts a hidden file input inside the chat container.
    const input = page.locator(
      "[data-multimodal-demo-chat-root] input[type='file']",
    );
    await expect(input).toHaveCount(1);
  });
});
