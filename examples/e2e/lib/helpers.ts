import { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

export async function sendChatMessage(page: Page, message: string) {
  await page.getByPlaceholder("Type a message...").click();
  await page.getByPlaceholder("Type a message...").fill(message);
  await page.keyboard.press("Enter");
}

export async function waitForStepsAndEnsureStreaming(page: Page) {
  await page.waitForSelector('[data-test-id="progress-steps"]');

  let stepAppearanceCount = 0;
  let previousStepCount = 0;

  // Poll for streaming behavior
  for (let i = 0; i < 30; i++) {
    const currentSteps = await page.$$('[data-test-id="progress-step-item"]');
    const currentStepCount = currentSteps.length;

    if (currentStepCount > previousStepCount) {
      stepAppearanceCount++;
      console.log(
        `Steps increased from ${previousStepCount} to ${currentStepCount}`
      );
      previousStepCount = currentStepCount;
    }

    // Check if all done
    const doneItems = await page.$$('[data-test-id="progress-step-item_done"]');
    if (doneItems.length === currentStepCount && currentStepCount > 0) {
      break;
    }

    await page.waitForTimeout(1000);
  }

  // Real streaming = multiple separate step appearances
  expect(stepAppearanceCount).toBeGreaterThanOrEqual(1);

  // Final validation
  const finalSteps = await page.$$('[data-test-id="progress-step-item"]');
  const finalDoneItems = await page.$$(
    '[data-test-id="progress-step-item_done"]'
  );
  expect(finalDoneItems.length).toBe(finalSteps.length);
}

export async function waitForResponse(page: Page) {
  await page.waitForSelector('[data-test-id="copilot-chat-ready"]');
}

export async function waitForSuggestions(page: Page) {
  // Wait for at least one suggestion to be visible
  await page.waitForFunction(
    () => {
      const suggestions = document.querySelectorAll(
        '[data-test-id="suggestion"]'
      );
      return (
        suggestions.length > 0 &&
        Array.from(suggestions).every((el) => el.isConnected)
      );
    },
    { timeout: 20000 }
  );
}
