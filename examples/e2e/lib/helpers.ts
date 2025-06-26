import { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

export async function sendChatMessage(page: Page, message: string) {
  await page.getByPlaceholder("Type a message...").click();
  await page.getByPlaceholder("Type a message...").fill(message);
  await page.keyboard.press("Enter");
}

export async function waitForStepsAndEnsureStreaming(page: Page) {
  await page.waitForSelector('[data-test-id="progress-steps"]');
  console.log("✓ Progress steps container found");

  // Track loading → done transitions instead of step appearances
  const streamingResult = (await page.evaluate(() => {
    return new Promise((resolve) => {
      const progressContainer = document.querySelector(
        '[data-test-id="progress-steps"]'
      );
      let doneTransitions = 0;
      let transitionTimestamps: number[] = [];
      let previousDoneCount = 0;

      const checkTransitions = () => {
        const currentDoneSteps = document.querySelectorAll(
          '[data-test-id="progress-step-item_done"]'
        );
        const currentDoneCount = currentDoneSteps.length;
        const totalSteps = document.querySelectorAll(
          '[data-test-id="progress-step-item"]'
        ).length;

        if (currentDoneCount > previousDoneCount) {
          doneTransitions++;
          transitionTimestamps.push(Date.now());
          console.log(
            `🔄 STATE TRANSITION: ${previousDoneCount} → ${currentDoneCount} done steps (transition #${doneTransitions})`
          );
          previousDoneCount = currentDoneCount;
        }

        // All steps completed
        if (currentDoneCount === totalSteps && totalSteps > 0) {
          resolve({
            doneTransitions,
            transitionTimestamps,
            totalSteps,
          });
          return;
        }

        // Continue checking
        setTimeout(checkTransitions, 50); // Fast polling for state changes
      };

      // Start checking
      checkTransitions();

      // Timeout after 30 seconds
      setTimeout(() => {
        resolve({
          doneTransitions,
          transitionTimestamps,
          totalSteps: document.querySelectorAll(
            '[data-test-id="progress-step-item"]'
          ).length,
        });
      }, 30000);
    });
  })) as {
    doneTransitions: number;
    transitionTimestamps: number[];
    totalSteps: number;
  };

  console.log(
    `🎯 Streaming result: ${streamingResult.doneTransitions} done transitions`
  );
  console.log(
    `📅 Transition times: ${streamingResult.transitionTimestamps
      .map((t) => new Date(t).toISOString())
      .join(", ")}`
  );

  if (streamingResult.doneTransitions <= 1) {
    console.log(
      `❌ STREAMING FAILED: Only ${streamingResult.doneTransitions} state transition detected`
    );
  } else {
    console.log(
      `✅ STREAMING SUCCESS: ${streamingResult.doneTransitions} separate state transitions detected`
    );
  }

  expect(streamingResult.doneTransitions).toBeGreaterThan(1);
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
