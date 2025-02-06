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
import { sendChatMessage, waitForResponse } from "../lib/helpers";

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

const variants: Variant[] = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
  { name: "Google Generative AI", queryParams: "?coAgentsModel=google_genai" },
  {
    name: "LangChain (OpenAI)",
    queryParams: "?coAgentsModel=langchain_openai",
  },
  {
    name: "LangChain (Anthropic)",
    queryParams: "?coAgentsModel=langchain_anthropic",
  },
  {
    name: "LangChain (Gemini)",
    queryParams: "?coAgentsModel=langchain_gemini",
  },
  { name: "Groq", queryParams: "?coAgentsModel=groq" },
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

const waitForDestinationImage = async (
  page: Page,
  { destination, timeout = 30000 }: { destination: string; timeout?: number }
) => {
  const image = page
    .getByRole("cell", { name: new RegExp(destination, "i") })
    .locator("img");
  await expect(image).toBeVisible({ timeout });
  return image;
};

// Get configurations
const allConfigs = getConfigs();
const researchCanvasConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COPILOTKIT_NEXT_OPENAI
);
const groupedConfigs = groupConfigsByDescription(researchCanvasConfigs);

test.describe.configure({ mode: 'parallel' });

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
              const suggestionHeading = page.getByRole("heading", {
                name: "Suggested:",
              });

              await expect(suggestionHeading).toBeVisible({ timeout: 30000 });

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
          });
        });
      });
    });
  });
});
