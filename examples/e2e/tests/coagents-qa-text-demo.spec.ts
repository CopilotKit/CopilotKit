import { test, expect } from "@playwright/test";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
  TestVariants,
  appendLGCVariants,
} from "../lib/config-helper";

const variants: TestVariants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
  // { name: "Google Generative AI", queryParams: "?coAgentsModel=google_genai" }, // seems broken
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
          appendLGCVariants(
            {
              ...config,
              lgcJSDeploymentUrl:
                  config.lgcJSDeploymentUrl ??
                "https://coagents-qa-text-stg-js-4d74616e480750d0a5d10d0c3c5d44a4.default.us.langgraph.app",
            },
            variants
          ).forEach((variant) => {
            test(`Test ${config.description} with variant ${variant.name}`, async ({
              page,
            }) => {
              // Navigate to the page with the specific variant
              await page.goto(`${config.url}${variant.queryParams}`);

              // Wait for CopilotKit popup to be ready
              await page.waitForSelector(".copilotKitPopup", {
                state: "visible",
                timeout: 10000,
              });

              // Click the CopilotKit button to open the chat window if it's not already open
              const chatWindow = await page.locator(".copilotKitWindow");
              if (!(await chatWindow.isVisible())) {
                await page.locator(".copilotKitButton").click();
                await chatWindow.waitFor({ state: "visible" });
              }

              const prompts = ["Greet Me!", "My name is Bob"];

              for (const prompt of prompts) {
                // Wait for and fill the textarea
                const textarea = page.locator(".copilotKitInput textarea");
                await textarea.waitFor({ state: "visible" });
                await textarea.click();
                await textarea.fill(prompt);

                // Get the send button and ensure it's enabled before clicking
                const sendButton = page.locator(
                  ".copilotKitInputControls button"
                );
                await sendButton.waitFor({ state: "visible" });

                // Only proceed if the button is not disabled
                if (!(await sendButton.isDisabled())) {
                  // Click the send button instead of pressing Enter
                  await sendButton.click();

                  // Wait for the in-progress state
                  await expect(sendButton)
                    .toHaveAttribute("data-copilotkit-in-progress", "true", {
                      timeout: 5000,
                    })
                    .catch(() => {
                      // console.log("Missed in-progress state");
                    });

                  // Wait for completion
                  await expect(sendButton).toHaveAttribute(
                    "data-copilotkit-in-progress",
                    "false",
                    { timeout: 30000 }
                  );

                  // Additional wait for the message to be fully rendered
                  await page.waitForTimeout(1000);
                }

                // Add delay between messages
                await page.waitForTimeout(5000);
              }
            });
          });
        });
      });
    });
  });
});
