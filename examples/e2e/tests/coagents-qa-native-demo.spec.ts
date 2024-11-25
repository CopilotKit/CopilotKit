import { test, expect } from "@playwright/test";
import { sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";

const lgcDeploymentUrlPython = 'https://coagents-qa-native-lgc-b-60a07709d8f651c584bbe3cc8e74ae3c.default.us.langgraph.app'
const lgcDeploymentUrlJS = 'https://coagents-qa-native-js-lgc-b-937eba63d4a0538e819aeea8cb472a7b.default.us.langgraph.app'
export const variants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "OpenAI (LGC Python)", queryParams: `?coAgentsModel=openai&lgcDeploymentUrl=${lgcDeploymentUrlPython}` },
  { name: "OpenAI (LGC JS)", queryParams: `?coAgentsModel=openai&lgcDeploymentUrl=${lgcDeploymentUrlJS}` },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
  { name: "Anthropic (LGC Python)", queryParams: `?coAgentsModel=anthropic&lgcDeploymentUrl=${lgcDeploymentUrlPython}` },
  { name: "Anthropic (LGC JS)", queryParams: `?coAgentsModel=anthropic&lgcDeploymentUrl=${lgcDeploymentUrlJS}` },
  // { name: "Google Generative AI", queryParams: "?coAgentsModel=google_genai" }, // seems broken
];

const allConfigs = getConfigs();
const qaConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_QA_NATIVE
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
              // Handle dialogs
              let isFirstDialog = true;
              page.on("dialog", (dialog) => {
                if (isFirstDialog) {
                  isFirstDialog = false;
                  dialog.dismiss();
                } else {
                  dialog.accept();
                }
              });

              // Navigate to page
              await page.goto(`${config.url}${variant.queryParams}`);

              // First attempt - Cancel
              await sendChatMessage(
                page,
                "write an email to the CEO of OpenAI asking for a meeting"
              );

              const cancelMessage = page.locator(
                '[data-test-id="email-cancel-message"]'
              );
              await expect(cancelMessage).toHaveText(
                "❌ Cancelled sending email."
              );

              // Second attempt - Send
              await sendChatMessage(page, "redo");

              const successMessage = page.locator(
                '[data-test-id="email-success-message"]'
              );
              await expect(successMessage).toHaveText("✅ Sent email.");
            });
          });
        });
      });
    });
  });
});
