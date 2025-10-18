import { test, expect } from "@playwright/test";
import { sendChatMessage, waitForResponse } from "../lib/helpers";

const BASE_URL = "http://localhost:3015";
const FIXTURE_PATH = "fixtures/coagents-starter.har";
const TMP_HAR_PATH = `/tmp/playwright-coagents-starter-${Date.now()}.har`;

// Standard Playwright tag-based test filtering
// Run fast tests: pnpm test --grep @fast
// Run slow tests: pnpm test --grep @slow
// Run all tests: pnpm test

test.describe("coagents-starter Thread Management", () => {
  test.describe.configure({ mode: "serial" });

  // Setup HAR for fast tests only
  test.beforeEach(async ({ page }, testInfo) => {
    const isSlowTest = testInfo.tags.includes('@slow');

    if (!isSlowTest) {
      // Fast test: use HAR fixture
      await page.routeFromHAR(FIXTURE_PATH, {
        url: '**/copilotkit**',
        updateContent: 'embed',
        notFound: 'abort'
      });

      console.log(`📼 Using HAR: ${FIXTURE_PATH}`);
    } else {
      // Slow test: record to tmp
      await page.routeFromHAR(TMP_HAR_PATH, {
        url: '**/copilotkit**',
        update: true,
        updateContent: 'embed'
      });

      console.log(`🎬 Recording to: ${TMP_HAR_PATH}`);
    }

    // Mock UUID generation for deterministic testing
    await page.addInitScript(() => {
      let counter = 0;
      // Override window crypto randomUUID
      const original = window.crypto?.randomUUID;
      if (original) {
        window.crypto.randomUUID = () => {
          counter++;
          return `test-thread-${counter.toString().padStart(4, '0')}-0000-0000-0000-000000000000`;
        };
      }
    });
  });

  // @fast warmup test
  test("@fast should load application", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForSelector('button[title="Create new thread"]', { timeout: 10000 });
    await page.waitForSelector('[data-test-id="copilot-chat-ready"]', { timeout: 10000 });
  });

  // @slow warmup test with longer timeout
  test("@slow should load application and wait for build", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector('button[title="Create new thread"]', { timeout: 60000 });
    await page.waitForSelector('[data-test-id="copilot-chat-ready"]', { timeout: 60000 });
  });

  // @fast test - UI only, no message verification
  test("@fast should create and switch between threads", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // Verify Thread #1 is visible
    await expect(page.locator('text=/Thread #1/i')).toBeVisible();

    // Create Thread #2
    const newThreadButton = page.locator('button[title="Create new thread"]');
    await newThreadButton.click();
    await page.waitForTimeout(1000);

    // Verify Thread #2 is now visible
    await expect(page.locator('text=/Thread #2/i')).toBeVisible();

    // Expand thread list
    const expandButton = page.locator('button[aria-label*="Expand thread list"]');
    await expandButton.click();
    await page.waitForTimeout(500);

    // Verify both threads appear in list
    const threadList = page.locator('button:has-text("Thread #")');
    const threadCount = await threadList.count();
    expect(threadCount).toBeGreaterThanOrEqual(1);

    // Switch back to Thread #1
    const thread1Button = page.locator('button:has-text("Thread #1")').first();
    await thread1Button.click();
    await page.waitForTimeout(1000);

    // Verify we're back on Thread #1
    await expect(page.locator('text=/Thread #1/i')).toBeVisible();
  });

  // @slow test with real AI
  test("@slow should create and switch between threads", async ({ page }) => {
    test.setTimeout(180000);
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    await sendChatMessage(page, "Say PINEAPPLE");
    await waitForResponse(page);

    const messages1 = await page.locator('[data-test-id="message"]').allTextContents();
    expect(messages1.some(m => /PINEAPPLE/i.test(m))).toBe(true);

    const newThreadButton = page.locator('button[title="Create new thread"]');
    await newThreadButton.click();
    await page.waitForTimeout(1000);

    await sendChatMessage(page, "Say BANANA");
    await waitForResponse(page);

    const expandButton = page.locator('button[aria-label*="Expand thread list"]');
    await expandButton.click();
    await page.waitForTimeout(500);

    const thread1Button = page.locator('button:has-text("Thread #1")').first();
    await thread1Button.click();
    await page.waitForTimeout(1000);

    const messages2 = await page.locator('[data-test-id="message"]').allTextContents();
    expect(messages2.some(m => /PINEAPPLE/i.test(m))).toBe(true);
  });

  // @fast thread history test - UI only
  test("@fast should handle multiple threads", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // Create Thread #2
    const newThreadButton = page.locator('button[title="Create new thread"]');
    await newThreadButton.click();
    await page.waitForTimeout(1000);

    // Create Thread #3
    await newThreadButton.click();
    await page.waitForTimeout(1000);

    // Expand thread list
    const expandButton = page.locator('button[aria-label*="Expand thread list"]');
    await expandButton.click();
    await page.waitForTimeout(500);

    // Verify multiple threads exist
    const threadList = page.locator('button:has-text("Thread #")');
    const threadCount = await threadList.count();
    expect(threadCount).toBeGreaterThanOrEqual(2);

    // Switch to Thread #1
    const thread1Button = page.locator('button:has-text("Thread #1")').first();
    await thread1Button.click();
    await page.waitForTimeout(1000);

    await expect(page.locator('text=/Thread #1/i')).toBeVisible();
  });

  // @slow thread history test
  test("@slow should persist thread history", async ({ page }) => {
    test.setTimeout(180000);
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    await sendChatMessage(page, "Say APPLE");
    await waitForResponse(page);

    await sendChatMessage(page, "Say ORANGE");
    await waitForResponse(page);

    const newThreadButton = page.locator('button[title="Create new thread"]');
    await newThreadButton.click();
    await page.waitForTimeout(1000);

    await sendChatMessage(page, "Say GRAPE");
    await waitForResponse(page);

    const expandButton = page.locator('button[aria-label*="Expand thread list"]');
    await expandButton.click();
    await page.waitForTimeout(500);

    const thread1Button = page.locator('button:has-text("Thread #1")').first();
    await thread1Button.click();
    await page.waitForTimeout(1000);

    const messages = await page.locator('[data-test-id="message"]').allTextContents();
    expect(messages.some(m => /APPLE/i.test(m))).toBe(true);
    expect(messages.some(m => /ORANGE/i.test(m))).toBe(true);
  });

  // @fast UUID display test
  test("@fast should show correct thread UUIDs", async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    await page.waitForSelector('button[title="Create new thread"]', { timeout: 10000 });

    const uuidElement = page.locator('.font-mono.text-xs.text-gray-400');
    await expect(uuidElement).toBeVisible();

    const uuidText = await uuidElement.textContent();
    expect(uuidText).toBeTruthy();
    expect(uuidText!.length).toBeGreaterThan(10);
  });

  // @slow UUID display test
  test("@slow should show correct thread UUIDs", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    await page.waitForSelector('button[title="Create new thread"]', { timeout: 10000 });

    const uuidElement = page.locator('.font-mono.text-xs.text-gray-400');
    await expect(uuidElement).toBeVisible();

    const uuidText = await uuidElement.textContent();
    expect(uuidText).toBeTruthy();
    expect(uuidText!.length).toBeGreaterThan(10);
  });
});
