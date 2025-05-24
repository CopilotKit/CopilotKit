import { test, expect } from '@playwright/test';
import {
  getConfigs,
  filterConfigsByProject,
  PROJECT_NAMES,
  type TestVariants, // Assuming TestVariants is exported from config-helper
  type ConfigItem,  // Assuming ConfigItem is exported
} from "../lib/config-helper";

const PAGE_TIMEOUT = 10000;
const INTERACTION_DELAY = 6000;


// Define variants for the /multi page tests
// The /multi page takes a serviceAdapter query param
const variants: TestVariants = [
  { name: "OpenAI", queryParams: "?serviceAdapter=openai", },
  { name: "Anthropic", queryParams: "?serviceAdapter=anthropic" },
  { name: "Google Generative AI", queryParams: "?serviceAdapter=gemini" },
  // {
  //   name: "LangChain (OpenAI)",
  //   queryParams: "?serviceAdapter=langchain_openai",
  // },
  // {
  //   name: "LangChain (Anthropic)",
  //   queryParams: "?coAgentsModel=langchain_anthropic",
  // },
  // {
  //   name: "LangChain (Gemini)",
  //   queryParams: "?coAgentsModel=langchain_gemini",
  // },
  // { name: "Groq", queryParams: "?coAgentsModel=groq" },
];

// Get all configurations
const allConfigs = getConfigs();

// Filter for configurations related to the Next.js OpenAI example (which hosts /multi)
const nextOpenAIAppConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COPILOTKIT_NEXT_OPENAI // This should resolve to "next-openai"
);

test.describe("Multi-Action Page Tests (/multi)", () => {
  // Configure tests within this describe block to run in parallel
  test.describe.configure({ mode: 'parallel' });

  // Iterate over each configuration found for the Next OpenAI project
  // (Usually one, e.g., from "local-next-openai" key in app-configs.json)
  Object.values(nextOpenAIAppConfigs).forEach((config: ConfigItem) => {
    // Iterate over each defined variant
    variants.forEach((variant) => {
      const testSuiteTitle = `Config: ${config.description || config.key || 'N/A'} - Variant: ${variant.name}`;

      test.describe(testSuiteTitle, () => {
        // Test 1: multiple of the same action
        test('multiple of the same action', async ({ page }) => {
          page.setDefaultTimeout(PAGE_TIMEOUT);
          await page.goto(`${config.url}/multi${variant.queryParams}`);
          await page.getByRole('button', { name: 'Multiple of the same action' }).click();
          // It's better to locate by more specific selectors if possible,
          // but using .first() for "Continue" implies sequence is important.
          await page.getByRole('button', { name: 'Continue' }).first().click();
          await page.waitForTimeout(INTERACTION_DELAY); // Consider replacing with waitForResponse or specific UI change
          await page.getByRole('button', { name: 'Continue' }).first().click();
          await page.waitForTimeout(INTERACTION_DELAY);
          await page.getByRole('button', { name: 'Continue' }).first().click();
          // Asserting on body might be too broad; prefer specific message containers
          await expect(page.locator('body')).toContainText('70 degrees', { timeout: PAGE_TIMEOUT });
        });

        // Test 2: multiple different actions
        test('multiple different actions', async ({ page }) => {
          page.setDefaultTimeout(PAGE_TIMEOUT);
          await page.goto(`${config.url}/multi${variant.queryParams}`);
          await page.getByRole('button', { name: 'Multiple different actions' }).click();
          await page.getByRole('button', { name: 'Continue' }).first().click({ timeout: PAGE_TIMEOUT });
          await page.waitForTimeout(INTERACTION_DELAY);
          await page.getByRole('button', { name: 'Continue' }).first().click({ timeout: PAGE_TIMEOUT });
          await Promise.all([
            expect(page.locator('body')).toContainText('70 degrees', { timeout: PAGE_TIMEOUT }),
            expect(page.locator('body')).toContainText('Marriott', { timeout: PAGE_TIMEOUT }),
          ]);
        });

        // Test 3: multiple HITL actions and non-HITL actions
        test('multiple HITL actions and non-HITL actions', async ({ page }) => {
          page.setDefaultTimeout(PAGE_TIMEOUT);
          await page.goto(`${config.url}/multi${variant.queryParams}`);
          await page.getByRole('button', { name: 'Multiple HITL actions and non-hitl actions' }).click();
          await page.getByRole('button', { name: 'Continue' }).first().click();
          await page.waitForTimeout(INTERACTION_DELAY);
          await page.getByRole('button', { name: 'Continue' }).first().click();
          await page.waitForTimeout(INTERACTION_DELAY);
          await expect(page.getByText('Flight', { exact: true })).toBeVisible({ timeout: PAGE_TIMEOUT });
          // This data-test-id seems specific to CopilotChat, ensure it's relevant for /multi page's readiness
          // await expect(page.locator('[data-test-id="copilot-chat-ready"]')).toBeVisible({ timeout: PAGE_TIMEOUT });
          // Consider a more specific assertion for readiness after actions, like no loading indicators.
           const loadingIndicator = page.locator('div[aria-label="CopilotKit loading"]');
           await expect(loadingIndicator).not.toBeVisible();
        });

        // Test 4: adding a message with followUp set to false
        test('adding a message with followUp set to false does not trigger a follow-up message', async ({ page }) => {
          page.setDefaultTimeout(PAGE_TIMEOUT);
          await page.goto(`${config.url}/multi${variant.queryParams}`);
          await page.getByRole('button', { name: 'Add a message' }).click();
          await expect(page.getByText('Adding a message...')).toBeVisible({ timeout: PAGE_TIMEOUT });
          await expect(page.getByText('What is the weather in San Francisco')).toBeVisible({ timeout: PAGE_TIMEOUT });
          
          // Add a check for no follow-up (e.g., count messages or check for loading indicator)
          const assistantMessages = page.locator(".copilotKitMessage[data-message-role='assistant']");
          const initialAssistantMessageCount = await assistantMessages.count();
          await page.waitForTimeout(5000); // Give time for an erroneous follow-up
          const finalAssistantMessageCount = await assistantMessages.count();
          expect(finalAssistantMessageCount).toBe(initialAssistantMessageCount);
          
          const loadingIndicator = page.locator('div[aria-label="CopilotKit loading"]');
          await expect(loadingIndicator).not.toBeVisible();
        });
      });
    });
  });
});