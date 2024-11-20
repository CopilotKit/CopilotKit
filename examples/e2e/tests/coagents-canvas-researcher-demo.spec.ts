import { test, expect } from "@playwright/test";
import { waitForSteps, waitForResponse, sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";
import { variants } from "../lib/variants";

// Get configurations for Research Canvas project
const allConfigs = getConfigs();
const researchCanvasConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.RESEARCH_CANVAS
);
const groupedConfigs = groupConfigsByDescription(researchCanvasConfigs);

Object.entries(groupedConfigs).forEach(([projectName, descriptions]) => {
  test.describe(`${projectName}`, () => {
    Object.entries(descriptions).forEach(([description, configs]) => {
      test.describe(`${description}`, () => {
        configs.forEach((config) => {
          variants.forEach((model) => {
            test(`Test ${config.description} with variant ${model.name}`, async ({
              page,
            }) => {
              await page.goto(`${config.url}${model.queryParams}`);

              const researchQuestion = "Lifespan of penguins";
              await page
                .getByPlaceholder("Enter your research question")
                .fill(researchQuestion);

              await sendChatMessage(
                page,
                "Conduct research based on my research question, please"
              );

              await waitForSteps(page);
              await waitForResponse(page);

              const resourceCount = await page
                .locator('[data-test-id="resource"]')
                .count();

              await sendChatMessage(page, `Delete the first resource, please`);

              const deleteContainer = await page.locator(
                '[data-test-id="delete-resource-generative-ui-container"]'
              );
              expect(deleteContainer).toBeTruthy();

              await page.locator('button:has-text("Delete")').click();
              await waitForResponse(page);

              const newResourceCount = await page
                .locator('[data-test-id="resource"]')
                .count();
              expect(newResourceCount).toBe(resourceCount - 1);

              await page.keyboard.press("Enter");
            });
          });
        });
      });
    });
  });
});
