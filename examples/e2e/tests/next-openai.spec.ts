import { test, expect } from "@playwright/test";
import { waitForResponse, sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";

const variants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
  { name: "Google Generative AI", queryParams: "?coAgentsModel=google_genai" }, // ? maybe broken
];

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
            test(`Test ${config.description} (/ route) with variant ${variant.name}`, async ({
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

              // First, we expect the destinations to be unchecked
              await expect(getDestinationCheckbox({ destination: "new-york-city", isChecked: false })).toBeVisible();
              await expect(getDestinationCheckbox({ destination: "tokyo", isChecked: false })).toBeVisible();

              // Next, we ask AI to select the destinations
              await sendChatMessage(page, "Select New York City and Tokyo as destinations.");
              await waitForResponse(page);

              // Finally, we expect the destinations to be checked
              await expect(getDestinationCheckbox({ destination: "new-york-city", isChecked: true })).toBeVisible();
              await expect(getDestinationCheckbox({ destination: "tokyo", isChecked: true })).toBeVisible();

              // Ask to deselect Tokyo
              await sendChatMessage(page, "Actually, please deselect New York City.");
              await waitForResponse(page);

              // Validate
              await expect(getDestinationCheckbox({ destination: "new-york-city", isChecked: false })).toBeVisible();
              await expect(getDestinationCheckbox({ destination: "tokyo", isChecked: true })).toBeVisible();
            });
          });
        });
      });
    });
  });
});
