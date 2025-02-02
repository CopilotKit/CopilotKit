import { test, expect } from "@playwright/test";
import { sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
  TestVariants,
  appendLGCVariants,
  getCopilotCloudVariants,
} from "../lib/config-helper";

const variants: TestVariants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
  ...getCopilotCloudVariants(),
];

const allConfigs = getConfigs();
const qaConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_QA_NATIVE
);
const groupedConfigs = groupConfigsByDescription(qaConfigs);

export const cloudVariants = variants.filter((variant) => variant.isCloud);
export const nonCloudVariants = variants.filter((variant) => !variant.isCloud);

test.describe.configure({ mode: 'parallel' });

Object.entries(groupedConfigs).forEach(([projectName, descriptions]) => {
  test.describe(`${projectName}`, () => {
    Object.entries(descriptions).forEach(([description, configs]) => {
      test.describe(`${description}`, () => {
        configs.forEach((config) => {
          [
            ...appendLGCVariants(
              {
                ...config,
              },
              nonCloudVariants
            ),
            ...cloudVariants,
          ].forEach((variant) => {
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
