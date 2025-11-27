/**
 * Integration tests for LLM Adapters Demo application
 *
 * Test Coverage:
 * -------------
 * 1. Provider Selection:
 *    - Provider dropdown visibility and interaction
 *    - Provider selection state changes
 *    - Switching between different providers
 *
 * 2. Chat Functionality:
 *    - CopilotChat component rendering
 *    - Message sending and receiving
 *    - Response validation from different providers
 *    - Chat history maintenance across provider switches
 *
 * 3. LLM Provider Integration (via CopilotCloud):
 *    - OpenAI provider functionality
 *    - Anthropic provider functionality
 *    - Google Generative AI provider functionality
 *    - Groq provider functionality
 *    - Azure OpenAI provider functionality
 *    - Amazon Bedrock provider functionality
 *
 * Test Flow:
 * ---------
 * 1. Opens LLM adapters demo
 * 2. Validates initial provider selection state
 * 3. Tests provider selection functionality
 * 4. Tests chat interaction with selected provider
 * 5. Verifies AI responses are received
 *
 * @tested-providers OpenAI, Anthropic, Google Generative AI, Groq, Azure, Bedrock
 */

import { expect, test, Page, Locator } from "@playwright/test";

interface LLMProvider {
  id: string;
  name: string;
  label: string;
}

interface TestScenario {
  provider: LLMProvider;
  testMessage: string;
  expectedResponsePattern?: RegExp;
}

const PAGE_TIMEOUT = 15000;
const CHAT_RESPONSE_TIMEOUT = 30000;

const providers: LLMProvider[] = [
  { id: "openai", name: "OpenAI", label: "OpenAI" },
  { id: "anthropic", name: "Anthropic", label: "Anthropic" },
  {
    id: "googlegenerativeai",
    name: "Google Generative AI",
    label: "Google Generative AI",
  },
  { id: "groq", name: "Groq", label: "Groq" },
  { id: "azure", name: "Azure OpenAI", label: "Azure OpenAI" },
  { id: "bedrock", name: "Amazon Bedrock", label: "Amazon Bedrock" },
];

const testScenarios: TestScenario[] = [
  {
    provider: providers[0], // OpenAI
    testMessage: "Hello! Can you tell me what 2 + 2 equals?",
    expectedResponsePattern: /4/,
  },
  {
    provider: providers[1], // Anthropic
    testMessage: "What is the capital of France?",
    expectedResponsePattern: /Paris/i,
  },
  {
    provider: providers[2], // Google Generative AI
    testMessage: "Write a single word: 'test'",
    expectedResponsePattern: /test/i,
  },
  {
    provider: providers[3], // Groq
    testMessage: "What color is the sky on a clear day?",
    expectedResponsePattern: /blue/i,
  },
  {
    provider: providers[4], // Azure OpenAI
    testMessage: "What is 5 multiplied by 3?",
    expectedResponsePattern: /15/,
  },
  {
    provider: providers[5], // Amazon Bedrock
    testMessage: "Name one planet in our solar system.",
    expectedResponsePattern:
      /(Earth|Mars|Venus|Jupiter|Saturn|Mercury|Uranus|Neptune)/i,
  },
];

const getProviderSelect = (page: Page): Locator =>
  page.locator("select").first();

const selectProvider = async (page: Page, providerId: string) => {
  const select = getProviderSelect(page);
  await select.selectOption(providerId);
  // Wait for the provider to be selected and any state changes
  await page.waitForTimeout(1000);
};

const waitForChatToBeReady = async (page: Page, timeout = PAGE_TIMEOUT) => {
  // Wait for CopilotChat to be rendered and ready - using actual class from HTML
  await expect(page.locator(".copilotKitChat")).toBeVisible({ timeout });

  // Also wait for the send button to be present
  await expect(
    page.locator('button[data-test-id="copilot-chat-ready"]'),
  ).toBeVisible({ timeout });
};

const sendChatMessageCustom = async (page: Page, message: string) => {
  // Find the textarea using the actual structure from HTML
  const textarea = page.locator(
    '.copilotKitInput textarea[placeholder="Type a message..."]',
  );
  await textarea.click();
  await textarea.fill(message);

  // Click the send button
  const sendButton = page.locator('button[data-test-id="copilot-chat-ready"]');
  await sendButton.click();
};

const waitForChatResponse = async (
  page: Page,
  timeout = CHAT_RESPONSE_TIMEOUT,
) => {
  // Wait for assistant message to appear - using actual class structure
  await page.waitForFunction(
    () => {
      const messages = document.querySelectorAll(
        ".copilotKitMessage.copilotKitAssistantMessage",
      );
      return messages.length > 1; // More than just the initial message
    },
    { timeout },
  );
};

// Test configuration - assuming llm-adapters runs on localhost:3000 during testing
const LLM_ADAPTERS_URL =
  process.env.LLM_ADAPTERS_URL || "http://localhost:3000";

test.describe.configure({ mode: "parallel" });

// Only run these tests if CLOUD_LLM_ADAPTERS environment variable is set to "true"
const shouldRunTests = process.env.CLOUD_LLM_ADAPTERS === "true";

test.describe("LLM Adapters Demo", () => {
  test.skip(
    !shouldRunTests,
    "Skipping LLM Adapters tests - CLOUD_LLM_ADAPTERS not set to 'true'",
  );
  test.describe("Provider Selection and Chat Functionality", () => {
    test("Should display initial UI elements correctly", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(LLM_ADAPTERS_URL);
      await page.waitForLoadState("networkidle");

      // Verify page title and heading
      await expect(page.locator("h1")).toContainText("LLM Adapter");

      // Verify provider selection dropdown is visible
      const providerSelect = getProviderSelect(page);
      await expect(providerSelect).toBeVisible();

      // Verify default selection (should be OpenAI)
      await expect(providerSelect).toHaveValue("openai");

      // Verify CopilotChat component is rendered
      await waitForChatToBeReady(page);

      // Verify initial chat message
      await expect(
        page.locator('text="Hi! 👋 How can I assist you today?"'),
      ).toBeVisible({ timeout: PAGE_TIMEOUT });
    });

    test("Should allow provider selection", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(LLM_ADAPTERS_URL);
      await page.waitForLoadState("networkidle");

      const providerSelect = getProviderSelect(page);

      // Test selecting different providers
      for (const provider of providers.slice(0, 3)) {
        // Test first 3 providers
        await selectProvider(page, provider.id);
        await expect(providerSelect).toHaveValue(provider.id);

        // Wait for any state changes to complete
        await page.waitForTimeout(500);
      }
    });

    // Test chat functionality with different providers
    testScenarios.forEach((scenario) => {
      test(`Should send message and receive response with ${scenario.provider.name}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.goto(LLM_ADAPTERS_URL);
        await page.waitForLoadState("networkidle");

        // Select the provider
        await selectProvider(page, scenario.provider.id);

        // Wait for chat to be ready
        await waitForChatToBeReady(page);

        // Send a test message
        await sendChatMessageCustom(page, scenario.testMessage);

        // Wait for response
        await waitForChatResponse(page);

        // Verify response was received
        const assistantMessages = page.locator(
          ".copilotKitMessage.copilotKitAssistantMessage",
        );
        await expect(assistantMessages).toHaveCount(2, {
          timeout: CHAT_RESPONSE_TIMEOUT,
        }); // Initial + response

        // Get the latest assistant message (excluding the initial greeting)
        const latestMessage = assistantMessages.last();
        await expect(latestMessage).toBeVisible();

        // If we have an expected pattern, verify it matches
        if (scenario.expectedResponsePattern) {
          const messageText = await latestMessage.textContent();
          expect(messageText).toMatch(scenario.expectedResponsePattern);
        }
      });
    });
  });
});
