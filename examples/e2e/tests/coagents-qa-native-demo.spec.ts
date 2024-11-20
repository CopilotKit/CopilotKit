import { test, expect } from "@playwright/test";
import { waitForSteps, waitForResponse, sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";
import { variants } from "../lib/variants";

const allConfigs = getConfigs();
const qaConfigs = filterConfigsByProject(allConfigs, PROJECT_NAMES.QA_NATIVE);
const groupedConfigs = groupConfigsByDescription(qaConfigs);

Object.entries(groupedConfigs).forEach(([projectName, descriptions]) => {
  test.describe(`${projectName}`, () => {
    Object.entries(descriptions).forEach(([description, configs]) => {
      test.describe(`${description}`, () => {
        configs.forEach((config) => {
          variants.forEach((model) => {
            test(`Test ${config.description} with variant ${model.name}`, async ({
              page,
            }) => {
              test.setTimeout(30000);

              await page.goto(`${config.url}${model.queryParams}`);

              // Handle dialogs upfront
              page.on("dialog", async (dialog) => {
                if (!(await page.locator("text=Cancelled").isVisible())) {
                  await dialog.dismiss();
                } else {
                  await dialog.accept();
                }
              });

              // Look for any visible text that confirms we're on the right page
              await expect(page.locator("text=Email Q&A example")).toBeVisible({
                timeout: 10000,
              });

              // Initial email request
              await sendChatMessage(
                page,
                "write an email to the CEO of OpenAI asking for a meeting"
              );

              // Wait for response
              await waitForSteps(page);
              await waitForResponse(page);

              // Wait for and verify cancel message (using text instead of test-id)
              await expect(page.locator("text=Cancelled")).toBeVisible({
                timeout: 10000,
              });

              // Redo request
              await sendChatMessage(page, "redo");

              // Wait for response
              await waitForSteps(page);
              await waitForResponse(page);

              // Wait for and verify success message (using text instead of test-id)
              await expect(page.locator("text=Sent")).toBeVisible({
                timeout: 10000,
              });
            });
          });
        });
      });
    });
  });
});
