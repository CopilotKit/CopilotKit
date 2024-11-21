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
  // { name: "Google Generative AI", queryParams: "?coAgentsModel=google_genai" },
  // { name: "LangGraph Cloud", quaeryParams: "?lgc=true" },
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
              await page.goto(`${config.url}${variant.queryParams}`);
              const prompts = [
                "How are you doing",
                "Greet Me!",
                "I'm not sure I want to tell you…",
                "My name is Copilot Kit",
              ];

              for (const prompt of prompts) {
                await sendChatMessage(page, prompt);
                const assistantMessage = page.locator(
                  '[data-message-role="assistant"]'
                );
                await expect(assistantMessage).toBeVisible();
                const text = await assistantMessage.textContent();
                expect(text).toBeTruthy();
              }
            });
          });
        });
      });
    });
  });
});
