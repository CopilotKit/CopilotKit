import { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

export async function validateResponseMessage(page: Page, message: string): Promise<void> {
  // Wait for the message to appear in the chat UI
  const messageElement = await page.waitForSelector(`text="${message}"`, { timeout: 5000 });

  // Wait for a `.copilotKitAssistantMessage` that comes **after** the message
  await page.waitForFunction((messageEl) => {
    const nextElements = [];
    let sibling = messageEl.nextElementSibling;

    while (sibling) {
      nextElements.push(sibling);
      sibling = sibling.nextElementSibling;
    }

    return nextElements.some(el => el.classList.contains('copilotKitAssistantMessage'));
  }, messageElement);

  await page.waitForTimeout(1500); // Wait for entire message to load
}

export async function sendChatMessage(page: Page, message: string, shouldValidateResponseMessage = false) {
  const input = page.getByPlaceholder("Type a message...");
  await input.click();
  await input.fill(message);
  await page.keyboard.press("Enter", { delay: 100 }); // Ensure Enter is detected
  shouldValidateResponseMessage ? await validateResponseMessage(page, message) : await Promise.resolve();
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
  await page.waitForSelector('[data-test-id="message-loading"]');
}

export async function waitForSuggestions(page: Page) {
  // Wait for at least one suggestion to be visible
  await page.waitForFunction(
    () => {
      const suggestions = document.querySelectorAll('[data-test-id="suggestion"]');
      return suggestions.length > 0 && Array.from(suggestions).every(el => el.isConnected);
    },
    { timeout: 20000 }
  );
}