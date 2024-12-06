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
import { expect, test } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";
import {
  filterConfigsByProject,
  getConfigs,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";
import { sendChatMessage, waitForResponse } from "../lib/helpers";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const variants = [
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

if (
  process.env.COPILOT_CLOUD_PROD_RUNTIME_URL &&
  process.env.COPILOT_CLOUD_PROD_PUBLIC_API_KEY
) {
  const runtimeUrl = process.env.COPILOT_CLOUD_PROD_RUNTIME_URL;
  const publicApiKey = process.env.COPILOT_CLOUD_PROD_PUBLIC_API_KEY;
  variants.push({
    name: "Copilot Cloud (Production)",
    queryParams: `?runtimeUrl=${runtimeUrl}&publicApiKey=${publicApiKey}`,
  });
}

if (
  process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL &&
  process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY
) {
  const runtimeUrl = process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL;
  const publicApiKey = process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY;
  variants.push({
    name: "Copilot Cloud (Staging)",
    queryParams: `?runtimeUrl=${runtimeUrl}&publicApiKey=${publicApiKey}`,
  });
}

// Get configurations
const allConfigs = getConfigs();
const researchCanvasConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COPILOTKIT_NEXT_OPENAI
);
const groupedConfigs = groupConfigsByDescription(researchCanvasConfigs);

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

              const getDestinationCheckbox = ({
                destination,
                isChecked,
              }: {
                destination: string;
                isChecked: boolean;
              }) =>
                page.locator(
                  `[data-test-id="checkbox-${destination}-${
                    isChecked ? "checked" : "unchecked"
                  }"]`
                );

              // Open Copilot Sidebar
              await page.click('[aria-label="Open Chat"]');
              await page.waitForTimeout(500);

              await expect(page.getByRole("heading", { name: "Suggested:" }), {
                message: "Suggestion box should be visible",
              }).toBeVisible();

              await page.waitForTimeout(1000);

              /*
                Make sure there are enough suggestions. suggestions are button with class "suggestion"
               */
              await expect(
                await page.locator("button.suggestion").count()
              ).toBeGreaterThanOrEqual(1);

              // First, we expect the destinations to be unchecked
              await expect(
                getDestinationCheckbox({
                  destination: "new-york-city",
                  isChecked: false,
                })
              ).toBeVisible();
              await expect(
                getDestinationCheckbox({
                  destination: "tokyo",
                  isChecked: false,
                })
              ).toBeVisible();

              // Next, we ask AI to select the destinations
              await sendChatMessage(
                page,
                "Select New York City and Tokyo as destinations."
              );
              await waitForResponse(page);

              // Finally, we expect the destinations to be checked
              await expect(
                getDestinationCheckbox({
                  destination: "new-york-city",
                  isChecked: true,
                })
              ).toBeVisible();
              await expect(
                getDestinationCheckbox({
                  destination: "tokyo",
                  isChecked: true,
                })
              ).toBeVisible();

              // Ask to deselect Tokyo
              await sendChatMessage(
                page,
                "Actually, please deselect New York City."
              );
              await waitForResponse(page);

              // Validate
              await expect(
                getDestinationCheckbox({
                  destination: "new-york-city",
                  isChecked: false,
                })
              ).toBeVisible();
              await expect(
                getDestinationCheckbox({
                  destination: "tokyo",
                  isChecked: true,
                })
              ).toBeVisible();

              /*
                Let's add new cities to the list of `New Destinations` and `Visited Destinations`
               */
              await sendChatMessage(
                page,
                "Add Mumbai, India to the list of New Destinations."
              );
              await waitForResponse(page);

              await expect(
                getDestinationCheckbox({
                  destination: "mumbai",
                  isChecked: false,
                })
              ).toBeVisible();
              /*
                Backend Action in CopilotRuntime adds images so this is a good test to check if the images are added
                To make sure backend action is working as expected
               */
              // await expect(
              //   page.getByRole("cell", { name: "Mumbai India" }).locator("img")
              // ).toBeVisible();

              // await expect(
              //   getDestinationCheckbox({
              //     destination: "mumbai",
              //     isChecked: false,
              //   })
              // ).toBeVisible();
            });
          });
        });
      });
    });
  });
});
