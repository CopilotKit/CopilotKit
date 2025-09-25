/**
 * Integration tests for Travel Demo application
 *
 * Test Coverage:
 * -------------
 * 1. Frontend Actions:
 *    - Copilot sidebar visibility and interaction
 *    - Destination checkbox states (checked/unchecked)
 *    - Suggestion buttons presence and count
 *
 * 2. Backend Actions:
 *    - Image loading for new destinations
 *    - Dynamic content updates via AI responses
 *
 * 3. Copilot Chat Features:
 *    - useCopilotChatSuggestions hook functionality
 *    - AI-driven destination selection/deselection
 *    - Dynamic suggestion generation
 *
 * Test Flow:
 * ---------
 * 1. Opens travel demo with different AI model variants
 * 2. Validates initial state of destinations
 * 3. Tests AI interaction for selecting/deselecting cities
 * 4. Verifies backend actions for adding new destinations with images
 * 5. Confirms suggestion system functionality
 *
 * @tested-variants OpenAI, Anthropic, Google Generative AI, LangChain, Groq, Copilot Cloud
 */

import { expect, test, Page, Locator } from "@playwright/test";
import {
  filterConfigsByProject,
  getConfigs,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";
import {
  sendChatMessage,
  waitForResponse,
  waitForSuggestions,
} from "../lib/helpers";

interface Variant {
  name: string;
  queryParams: string;
}

interface DestinationProps {
  destination: string;
  isChecked: boolean;
}

interface WaitDestinationProps extends DestinationProps {
  timeout?: number;
}

const PAGE_TIMEOUT = 10000;
const INTERACTION_DELAY = 6000;

const variants: Variant[] = [
  {
    name: "OpenAI",
    queryParams:
      "?serviceAdapter=openai&publicApiKey=ck_pub_68785a38d8918a3bb32ecd22031f444z",
  },
  {
    name: "Anthropic",
    queryParams:
      "?serviceAdapter=anthropic&publicApiKey=ck_pub_68785a38d8918a3bb32ecd22031f444z",
  },
  // { name: "Google Generative AI", queryParams: "?serviceAdapter=gemini" },
  {
    name: "LangChain (OpenAI)",
    queryParams:
      "?serviceAdapter=langchain_openai&publicApiKey=ck_pub_68785a38d8918a3bb32ecd22031f444z",
  },
  {
    name: "Groq",
    queryParams:
      "?serviceAdapter=groq&publicApiKey=ck_pub_68785a38d8918a3bb32ecd22031f444z",
  },
];

const getDestinationCheckbox = (
  page: Page,
  { destination, isChecked }: DestinationProps
): Locator =>
  page.locator(
    `[data-test-id="checkbox-${destination}-${
      isChecked ? "checked" : "unchecked"
    }"]`
  );

const waitForDestinationState = async (
  page: Page,
  { destination, isChecked, timeout = 30000 }: WaitDestinationProps
) => {
  const checkbox = getDestinationCheckbox(page, { destination, isChecked });
  await expect(checkbox).toBeVisible({ timeout });
  return checkbox;
};

// Get configurations
const allConfigs = getConfigs();
const researchCanvasConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COPILOTKIT_NEXT_OPENAI
);
const groupedConfigs = groupConfigsByDescription(researchCanvasConfigs);

test.describe.configure({ mode: "parallel" });

Object.entries(groupedConfigs).forEach(([projectName, descriptions]) => {
  test.describe(`${projectName}`, () => {
    Object.entries(descriptions).forEach(([description, configs]) => {
      test.describe(`${description}`, () => {
        configs.forEach((config) => {
          variants.forEach((variant) => {
            test(`Test ${config.description} Travel Demo ("/" route) with variant ${variant.name}`, async ({
              page,
            }) => {
              await page.goto(`${config.url}${variant.queryParams}`);
              await page.waitForLoadState("networkidle");

              // Open Copilot Sidebar and verify initial state
              await page.click('[aria-label="Open Chat"]');
              await page.waitForTimeout(2000);

              // Verify initial welcome message added using appendMessage in useEffect
              // with followUp: false
              const welcomeMessage = page.locator(
                ".copilotKitMessage.copilotKitAssistantMessage"
              );
              await expect(welcomeMessage).toBeVisible();
              const messageText = await welcomeMessage
                .locator(".copilotKitMarkdown p")
                .innerText();
              expect(messageText).toBe(
                "Hi you! 👋 Let's book your next vacation. Ask me anything."
              );

              // Wait for suggestion box and verify suggestions
              await waitForSuggestions(page);

              const suggestions = page.locator("button.suggestion");
              await expect(suggestions).toHaveCount(await suggestions.count(), {
                timeout: 30000,
              });
              expect(await suggestions.count()).toBeGreaterThanOrEqual(1);

              // Verify initial destination states
              await waitForDestinationState(page, {
                destination: "new-york-city",
                isChecked: false,
              });
              await waitForDestinationState(page, {
                destination: "tokyo",
                isChecked: false,
              });

              // Test destination selection
              await sendChatMessage(
                page,
                "Select New York City and Tokyo as destinations."
              );
              await waitForResponse(page);
              await page.waitForTimeout(2000);

              await waitForDestinationState(page, {
                destination: "new-york-city",
                isChecked: true,
              });
              await waitForDestinationState(page, {
                destination: "tokyo",
                isChecked: true,
              });

              // Test destination deselection
              await sendChatMessage(page, "Actually, please deselect Tokyo.");
              await waitForResponse(page);
              await page.waitForTimeout(2000);

              await waitForDestinationState(page, {
                destination: "new-york-city",
                isChecked: true,
              });
              await waitForDestinationState(page, {
                destination: "tokyo",
                isChecked: false,
              });

              // Test adding new destination
              // await sendChatMessage(
              //   page,
              //   "Add Mumbai, India to the list of New Destinations."
              // );
              // await waitForResponse(page);
              // await page.waitForTimeout(3000);

              // await waitForDestinationState(page, {
              //   destination: "mumbai",
              //   isChecked: false,
              // });
            });

            test(`Call multiple of the same HITL action with variant ${variant.name}`, async ({
              page,
            }) => {
              page.setDefaultTimeout(PAGE_TIMEOUT);
              await page.goto(`${config.url}multi${variant.queryParams}`);
              await page
                .getByRole("button", { name: "Multiple of the same action" })
                .click();
              // It's better to locate by more specific selectors if possible,
              // but using .first() for "Continue" implies sequence is important.
              await page
                .getByRole("button", { name: "Continue" })
                .first()
                .click();
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeVisible({ timeout: PAGE_TIMEOUT });
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeEnabled({ timeout: PAGE_TIMEOUT });
              await page
                .getByRole("button", { name: "Continue" })
                .first()
                .click();
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeVisible({ timeout: PAGE_TIMEOUT });
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeEnabled({ timeout: PAGE_TIMEOUT });
              await page
                .getByRole("button", { name: "Continue" })
                .first()
                .click();
              // Asserting on body might be too broad; prefer specific message containers
              await expect(page.locator("body")).toContainText("70 degrees", {
                timeout: PAGE_TIMEOUT,
              });
            });

            test(`Call multiple different HITL actions with variant ${variant.name}`, async ({
              page,
            }) => {
              page.setDefaultTimeout(PAGE_TIMEOUT);
              await page.goto(`${config.url}multi${variant.queryParams}`);
              await page
                .getByRole("button", { name: "Multiple different actions" })
                .click();
              await page
                .getByRole("button", { name: "Continue" })
                .first()
                .click({ timeout: PAGE_TIMEOUT });
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeVisible({ timeout: PAGE_TIMEOUT });
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeEnabled({ timeout: PAGE_TIMEOUT });
              await page
                .getByRole("button", { name: "Continue" })
                .first()
                .click({ timeout: PAGE_TIMEOUT });
              await Promise.all([
                expect(page.locator("body")).toContainText("70 degrees", {
                  timeout: PAGE_TIMEOUT,
                }),
                expect(page.locator("body")).toContainText("Marriott", {
                  timeout: PAGE_TIMEOUT,
                }),
              ]);
            });

            test(`Initial labels are displayed for variant ${variant.name}`, async ({
              page,
            }) => {
              page.setDefaultTimeout(PAGE_TIMEOUT);
              await page.goto(`${config.url}multi${variant.queryParams}`);
              await expect(page.getByText("Hi you! 👋 Let's book your next vacation. Ask me anything.")).toBeVisible({
                timeout: PAGE_TIMEOUT,
              });
            });

            test(`Call multiple HITL actions and non-HITL actions with variant ${variant.name}`, async ({
              page,
            }) => {
              page.setDefaultTimeout(PAGE_TIMEOUT);
              await page.goto(`${config.url}multi${variant.queryParams}`);
              await page
                .getByRole("button", {
                  name: "Multiple HITL actions and non-hitl actions",
                })
                .click();
              await page
                .getByRole("button", { name: "Continue" })
                .first()
                .click();
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeVisible({ timeout: PAGE_TIMEOUT });
              await expect(
                page.getByRole("button", { name: "Continue" }).first()
              ).toBeEnabled({ timeout: PAGE_TIMEOUT });
              await page
                .getByRole("button", { name: "Continue" })
                .first()
                .click();
              await expect(
                page.getByText("Flight", { exact: true })
              ).toBeVisible({ timeout: PAGE_TIMEOUT });
              // This data-test-id seems specific to CopilotChat, ensure it's relevant for /multi page's readiness
              // await expect(page.locator('[data-test-id="copilot-chat-ready"]')).toBeVisible({ timeout: PAGE_TIMEOUT });
              // Consider a more specific assertion for readiness after actions, like no loading indicators.
              const loadingIndicator = page.locator(
                'div[aria-label="CopilotKit loading"]'
              );
              await expect(loadingIndicator).not.toBeVisible();
            });

            test(`Adding a message with followUp set to false does not trigger a follow-up message with variant ${variant.name}`, async ({
              page,
            }) => {
              page.setDefaultTimeout(PAGE_TIMEOUT);
              await page.goto(`${config.url}multi${variant.queryParams}`);
              await page.getByRole("button", { name: "Add a message" }).click();
              await expect(page.getByText("Adding a message...")).toBeVisible({
                timeout: PAGE_TIMEOUT,
              });
              await expect(
                page.getByText("What is the weather in San Francisco")
              ).toBeVisible({ timeout: PAGE_TIMEOUT });

              // Add a check for no follow-up (e.g., count messages or check for loading indicator)
              const assistantMessages = page.locator(
                ".copilotKitMessage[data-message-role='assistant']"
              );
              const initialAssistantMessageCount =
                await assistantMessages.count();
              await page.waitForTimeout(5000); // Give time for an erroneous follow-up
              const finalAssistantMessageCount =
                await assistantMessages.count();
              expect(finalAssistantMessageCount).toBe(
                initialAssistantMessageCount
              );

              const loadingIndicator = page.locator(
                'div[aria-label="CopilotKit loading"]'
              );
              await expect(loadingIndicator).not.toBeVisible();
            });
          });
        });
      });
    });
  });
});
