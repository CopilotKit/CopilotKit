/**
 * Regression coverage for the form-filling chat window layout.
 */
import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("chat window layout", () => {
  test.skip(EXAMPLE !== "form-filling", `EXAMPLE=${EXAMPLE}`);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("copilot-popup")).toBeVisible();
  });

  test("chat body fills the popup", async ({ page }) => {
    const chatBody = page.locator("[data-popup-chat]");
    const popup = page.getByTestId("copilot-popup");

    await expect(chatBody).toHaveCSS("flex", "1 1 0%");

    const chatBodyBox = await chatBody.boundingBox();
    const popupBox = await popup.boundingBox();
    expect(chatBodyBox).not.toBeNull();
    expect(popupBox).not.toBeNull();
    expect(chatBodyBox!.height).toBeGreaterThan(popupBox!.height * 0.8);
  });

  test("chat fills the available body space", async ({ page }) => {
    const chat = page.getByTestId("copilot-chat");
    const chatBody = page.locator("[data-popup-chat]");

    await expect(chat).toHaveCSS("display", "flex");

    const chatBox = await chat.boundingBox();
    const chatBodyBox = await chatBody.boundingBox();
    expect(chatBox).not.toBeNull();
    expect(chatBodyBox).not.toBeNull();
    expect(chatBox!.height).toBeGreaterThan(chatBodyBox!.height * 0.9);
    expect(chatBox!.height).toBeLessThanOrEqual(chatBodyBox!.height);
  });

  test("input is pinned to the lower half of the popup", async ({ page }) => {
    const input = page.getByTestId("copilot-chat-input");
    const popup = page.getByTestId("copilot-popup");

    const inputBox = await input.boundingBox();
    const popupBox = await popup.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(popupBox).not.toBeNull();

    const inputMidY = inputBox!.y + inputBox!.height / 2;
    const popupMidY = popupBox!.y + popupBox!.height / 2;
    expect(inputMidY).toBeGreaterThan(popupMidY);
  });
});
