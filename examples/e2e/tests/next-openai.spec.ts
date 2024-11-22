import { test, expect } from "@playwright/test";
import { waitForResponse, sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const variants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
  { name: "Google Generative AI", queryParams: "?coAgentsModel=google_genai" },
  { name: "LangChain (OpenAI)", queryParams: "?coAgentsModel=langchain_openai" },
  { name: "LangChain (Anthropic)", queryParams: "?coAgentsModel=langchain_anthropic" },
  { name: "LangChain (Gemini)", queryParams: "?coAgentsModel=langchain_gemini" },
  { name: "Groq", queryParams: "?coAgentsModel=groq" },
];

if (process.env.COPILOT_CLOUD_PROD_RUNTIME_URL && process.env.COPILOT_CLOUD_PROD_PUBLIC_API_KEY) {
  const runtimeUrl = process.env.COPILOT_CLOUD_PROD_RUNTIME_URL;
  const publicApiKey = process.env.COPILOT_CLOUD_PROD_PUBLIC_API_KEY;
  variants.push({ name: "Copilot Cloud (Production)", queryParams: `?runtimeUrl=${runtimeUrl}&publicApiKey=${publicApiKey}` });
}

if (process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL && process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY) {
  const runtimeUrl = process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL;
  const publicApiKey = process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY;
  variants.push({ name: "Copilot Cloud (Staging)", queryParams: `?runtimeUrl=${runtimeUrl}&publicApiKey=${publicApiKey}` });
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

            // test(`Test ${config.description} Textarea Demo ("/textarea" route) with variant ${variant.name}`, async ({
            //   page,
            // }) => {
            //   await page.goto(`${config.url}/textarea${variant.queryParams}`);

            //   await page.getByTestId("copilot-textarea-editable").click();
            //   await page.keyboard.type("Hello, CopilotKit!", { delay: 25 });
              
            //   expect(page.getByTestId("suggestion")).not.toBeVisible();
            //   await page.waitForSelector("[data-testid='suggestion']", { state: "visible" });
            //   const suggestion = await page.getByTestId("suggestion").textContent();
            
            //   await page.keyboard.press("Tab");

            //   const contentPostCompletion = await page.getByTestId("copilot-textarea-editable").textContent();
            //   expect(contentPostCompletion?.trim().endsWith(suggestion!.trim())).toBe(true);
              
            //   await page.keyboard.press("ControlOrMeta+A");
            //   await page.waitForTimeout(250);

            //   await page.keyboard.down("ControlOrMeta");
            //   await page.keyboard.down("KeyK");
            //   await page.waitForSelector("[data-testid='menu']", { state: "visible" });
            //   await page.keyboard.up("KeyK");
            //   await page.keyboard.up("ControlOrMeta");

            //   await page.keyboard.type("Make it shorter", { delay: 25 });
            //   await page.keyboard.press("Enter");

            //   await page.waitForSelector("[data-testid='suggestion-result']", { state: "visible" });
            //   await page.waitForSelector("[data-testid='insert-button']", { state: "visible" });
            //   await page.waitForTimeout(250);
            //   await page.getByTestId("insert-button").click();

            //   const contentPostReplace = await page.getByTestId("copilot-textarea-editable").textContent();
            //   expect(contentPostReplace?.trim()).not.toBe(contentPostCompletion?.trim());
            // });
          });
        });
      });
    });
  });
});
