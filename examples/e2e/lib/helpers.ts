import { Page } from "@playwright/test";

export async function sendChatMessage(page: Page, message: string) {
  await page.getByPlaceholder("Type a message...").click();
  await page.getByPlaceholder("Type a message...").fill(message);
  await page.keyboard.press("Enter");
}

export async function waitForSteps(page: Page) {
  await page.waitForSelector('[data-test-id="progress-steps"]');
}

export async function waitForResponse(page: Page) {
  await page.waitForSelector("button:has-text('Regenerate response')");
}