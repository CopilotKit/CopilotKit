import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// The `agentic-chat-reasoning` cell is now the `reasoning-custom` demo, so
// these tests run on that page. reasoning-custom.spec.ts covers the reasoning
// block. These tests cover a clean page load and a reply to a sent message.

describeDemo("reasoning-custom", "Agentic Chat (Reasoning)", () => {
  test("loads without page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(demoPath("reasoning-custom"));
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("a sent message gets an assistant reply", async ({ page }) => {
    await page.goto(demoPath("reasoning-custom"));

    // The integration's aimock fixture answers this prompt.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("show your reasoning step by step");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
