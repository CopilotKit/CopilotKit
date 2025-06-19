import { test, expect } from "@playwright/test";
import { sendChatMessage } from "../lib/helpers";
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
];

const allConfigs = getConfigs();
const qaConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_QA_NATIVE
);
const groupedConfigs = groupConfigsByDescription(qaConfigs);

export const cloudVariants = variants.filter((variant) => variant.isCloud);
export const nonCloudVariants = variants.filter((variant) => !variant.isCloud);

test.describe.configure({ mode: "parallel" });

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
              nonCloudVariants,
              true
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

              // First interaction will bring up interrupt interface
              await page
                .getByPlaceholder("Your name")
                .fill("CopilotKit Automation");
              await page.locator('button:has-text("Submit")').click();

              await page.locator(
                'p:has-text("Ah, forgot to ask, which company are you working for?")'
              );
              await sendChatMessage(page, "CopilotKit");

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
