import { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

export async function sendChatMessage(page: Page, message: string) {
  await page.getByPlaceholder("Type a message...").click();
  await page.getByPlaceholder("Type a message...").fill(message);
  await page.keyboard.press("Enter");
}

export async function waitForStepsAndEnsureStreaming(page: Page) {
  await page.waitForSelector('[data-test-id="progress-steps"]');
  // expect at least one item is loading
  const loadingItems = await page.$$('[data-test-id="progress-step-item_loading"]');
  expect(loadingItems.length).toBeGreaterThan(0);

  // wait for all items to transition to done
  await page.waitForSelector('[data-test-id="progress-step-item_done"]');
  const doneItems = await page.$$('[data-test-id="progress-step-item_done"]');
  // expect all items to be in the "done" state
  expect(doneItems.length).toBeGreaterThan(0);
}

export async function waitForResponse(page: Page) {
  await page.waitForSelector("button:has-text('Regenerate response')");
}