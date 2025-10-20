import { test, expect } from "@playwright/test";
import { sendChatMessage, waitForResponse } from "../lib/helpers";

const BASE_URL = "http://localhost:3015";

test.describe("coagents-starter Extended Demo", () => {
  test("@slow should demonstrate extensive thread switching with 20+ messages", async ({ page }) => {
    test.setTimeout(300000); // 5 minutes timeout

    // Navigate to the app
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector('button[title="Create new thread"]', { timeout: 10000 });
    await page.waitForSelector('[data-test-id="copilot-chat-ready"]', { timeout: 10000 });

    console.log("✓ Application loaded");

    // Thread 1: Send multiple messages
    console.log("Thread #1: Sending messages...");
    await sendChatMessage(page, "Say: Hello from Thread 1!");
    await waitForResponse(page);

    await sendChatMessage(page, "Count to 3");
    await waitForResponse(page);

    await sendChatMessage(page, "What's 5 plus 7?");
    await waitForResponse(page);

    await sendChatMessage(page, "Name a fruit");
    await waitForResponse(page);

    console.log("✓ Thread #1: 4 messages sent");

    // Create Thread 2
    console.log("Creating Thread #2...");
    const newThreadButton = page.locator('button[title="Create new thread"]');
    await newThreadButton.click();
    await page.waitForTimeout(2000);

    // Thread 2: Send multiple messages
    console.log("Thread #2: Sending messages...");
    await sendChatMessage(page, "Say: Welcome to Thread 2!");
    await waitForResponse(page);

    await sendChatMessage(page, "What's the capital of France?");
    await waitForResponse(page);

    await sendChatMessage(page, "Give me a random number");
    await waitForResponse(page);

    await sendChatMessage(page, "Name a color");
    await waitForResponse(page);

    console.log("✓ Thread #2: 4 messages sent");

    // Create Thread 3
    console.log("Creating Thread #3...");
    await newThreadButton.click();
    await page.waitForTimeout(2000);

    // Thread 3: Send multiple messages
    console.log("Thread #3: Sending messages...");
    await sendChatMessage(page, "Say: This is Thread 3!");
    await waitForResponse(page);

    await sendChatMessage(page, "What year is it?");
    await waitForResponse(page);

    await sendChatMessage(page, "Name an animal");
    await waitForResponse(page);

    await sendChatMessage(page, "Count backwards from 5");
    await waitForResponse(page);

    console.log("✓ Thread #3: 4 messages sent");

    // Create Thread 4
    console.log("Creating Thread #4...");
    await newThreadButton.click();
    await page.waitForTimeout(2000);

    // Thread 4: Send multiple messages
    console.log("Thread #4: Sending messages...");
    await sendChatMessage(page, "Say: Fourth thread here!");
    await waitForResponse(page);

    await sendChatMessage(page, "What's 10 times 10?");
    await waitForResponse(page);

    await sendChatMessage(page, "Name a month");
    await waitForResponse(page);

    await sendChatMessage(page, "Say goodbye");
    await waitForResponse(page);

    console.log("✓ Thread #4: 4 messages sent");

    // Now switch between threads to show thread history
    console.log("Demonstrating thread switching...");

    // Expand thread list
    const expandButton = page.locator('button[aria-label*="Expand thread list"]');
    await expandButton.click();
    await page.waitForTimeout(1000);

    // Switch to Thread #1
    console.log("Switching to Thread #1...");
    const thread1Button = page.locator('button:has-text("Thread #1")').first();
    await thread1Button.click();
    await page.waitForTimeout(2000);

    // Send another message in Thread 1
    await sendChatMessage(page, "I'm back in Thread 1!");
    await waitForResponse(page);

    // Switch to Thread #2
    await expandButton.click();
    await page.waitForTimeout(1000);
    console.log("Switching to Thread #2...");
    const thread2Button = page.locator('button:has-text("Thread #2")').first();
    await thread2Button.click();
    await page.waitForTimeout(2000);

    // Send another message in Thread 2
    await sendChatMessage(page, "Back to Thread 2 now");
    await waitForResponse(page);

    // Switch to Thread #3
    await expandButton.click();
    await page.waitForTimeout(1000);
    console.log("Switching to Thread #3...");
    const thread3Button = page.locator('button:has-text("Thread #3")').first();
    await thread3Button.click();
    await page.waitForTimeout(2000);

    // Send another message in Thread 3
    await sendChatMessage(page, "Visiting Thread 3 again");
    await waitForResponse(page);

    // Final message in Thread 4
    await expandButton.click();
    await page.waitForTimeout(1000);
    console.log("Switching to Thread #4...");
    const thread4Button = page.locator('button:has-text("Thread #4")').first();
    await thread4Button.click();
    await page.waitForTimeout(2000);

    await sendChatMessage(page, "Final message in Thread 4");
    await waitForResponse(page);

    console.log("✓ Thread switching demonstration complete");
    console.log("✓ Total: 4 threads created with 20 messages sent");

    // Keep the page open for a few more seconds to ensure video captures everything
    await page.waitForTimeout(3000);
  });
});
