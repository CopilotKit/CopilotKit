/**
 * Regression test for the chat window flex layout broken in 1.55.
 *
 * Root cause: the drag-and-drop wrapper div introduced with attachments had
 * no CSS class when not dragging, so no flex rule applied and the chat body
 * collapsed to content height instead of filling the window.
 */
import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("chat window layout", () => {
  test.skip(EXAMPLE !== "form-filling", `EXAMPLE=${EXAMPLE}`);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // form-filling uses defaultOpen — window is already open after hydration
    await page.locator(".copilotKitWindow.open").waitFor({ timeout: 10_000 });
  });

  test("chat body fills the window", async ({ page }) => {
    const chatBody = page.locator(".copilotKitChatBody");
    const window = page.locator(".copilotKitWindow");

    await expect(chatBody).toHaveCSS("flex", "1 1 0%");

    const bodyBox = await chatBody.boundingBox();
    const windowBox = await window.boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(windowBox).not.toBeNull();
    expect(bodyBox!.height).toBeGreaterThan(windowBox!.height * 0.8);
  });

  test("messages area fills available space", async ({ page }) => {
    const messages = page.locator(".copilotKitMessages");
    const window = page.locator(".copilotKitWindow");

    const messagesBox = await messages.boundingBox();
    const windowBox = await window.boundingBox();
    expect(messagesBox).not.toBeNull();
    expect(windowBox).not.toBeNull();
    expect(messagesBox!.height).toBeGreaterThan(windowBox!.height * 0.5);
    expect(messagesBox!.height).toBeLessThanOrEqual(windowBox!.height);
  });

  test("input is pinned to the lower half of the window", async ({ page }) => {
    const input = page.locator(".copilotKitInput");
    const window = page.locator(".copilotKitWindow");

    const inputBox = await input.boundingBox();
    const windowBox = await window.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(windowBox).not.toBeNull();

    const inputMidY = inputBox!.y + inputBox!.height / 2;
    const windowMidY = windowBox!.y + windowBox!.height / 2;
    expect(inputMidY).toBeGreaterThan(windowMidY);
  });

  test("drag state does not break layout", async ({ page }) => {
    const chatBody = page.locator(".copilotKitChatBody");
    const messages = page.locator(".copilotKitMessages");
    const window = page.locator(".copilotKitWindow");

    await page.evaluate(() => {
      const body = document.querySelector(".copilotKitChatBody");
      body?.dispatchEvent(new DragEvent("dragenter", { bubbles: true }));
    });

    await expect(chatBody).toHaveCSS("flex", "1 1 0%");

    const messagesBox = await messages.boundingBox();
    const windowBox = await window.boundingBox();
    expect(messagesBox).not.toBeNull();
    expect(windowBox).not.toBeNull();
    expect(messagesBox!.height).toBeGreaterThan(windowBox!.height * 0.5);
  });
});
