import { test, expect } from "@playwright/test";
import { sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";

export const variants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
];

const allConfigs = getConfigs();
const qaConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_QA_TEXT
);
const groupedConfigs = groupConfigsByDescription(qaConfigs);

Object.entries(groupedConfigs).forEach(([projectName, descriptions]) => {
  test.describe(`${projectName}`, () => {
    Object.entries(descriptions).forEach(([description, configs]) => {
      test.describe(`${description}`, () => {
        configs.forEach((config) => {
          variants.forEach((variant) => {
            test(`Test ${config.description} with variant ${variant.name}`, async ({
              page,
            }) => {
              // Navigate to the page with the specific variant
              await page.goto(`${config.url}${variant.queryParams}`);

              // Wait for CopilotKit to be ready
              await page.waitForSelector(".copilotKitPopup", {
                state: "visible",
                timeout: 10000,
              });

              const prompts = [
                "How are you doing",
                "Greet Me!",
                "I'm not sure I want to tell you…",
                "My name is Copilot Kit",
              ];

              for (const prompt of prompts) {
                // Wait for and click the input field
                const textarea = await page
                  .locator(".copilotKitInput textarea")
                  .first();
                await textarea.click();
                await textarea.fill(prompt);
                await textarea.press("Enter");

                // Wait for the send button to complete
                const sendButton = page.locator(
                  ".copilotKitInputControls button"
                );
                await expect(sendButton).toBeEnabled({ timeout: 30000 });

                // Wait for the response
                await page.waitForTimeout(3000);

                // Add a longer delay between messages
                await page.waitForTimeout(2000);
              }
            });
          });
        });
      });
    });
  });
});
