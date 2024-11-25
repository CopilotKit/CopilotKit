import { test, expect } from "@playwright/test";
import { waitForSteps, waitForResponse, sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";

const lgcDeploymentUrlPython = 'https://coagents-research-canvas-br-cda7ddd686245735b2653e48370427b9.default.us.langgraph.app'
const lgcDeploymentUrlJS = 'https://coagents-research-canvas-js-d5ff2a34fa9c5771bb9c71003f38661c.default.us.langgraph.app'
export const variants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "OpenAI (LGC Python)", queryParams: `?coAgentsModel=openai&lgcDeploymentUrl=${lgcDeploymentUrlPython}` },
  { name: "OpenAI (LGC JS)", queryParams: `?coAgentsModel=openai&lgcDeploymentUrl=${lgcDeploymentUrlJS}` },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
  { name: "Anthropic (LGC Python)", queryParams: `?coAgentsModel=anthropic&lgcDeploymentUrl=${lgcDeploymentUrlPython}` },
  { name: "Anthropic (LGC JS)", queryParams: `?coAgentsModel=anthropic&lgcDeploymentUrl=${lgcDeploymentUrlJS}` },
  // { name: "Google Generative AI", queryParams: "?coAgentsModel=google_genai" }, // seems broken
];

// Get configurations
const allConfigs = getConfigs();
const researchCanvasConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_RESEARCH_CANVAS
);
const groupedConfigs = groupConfigsByDescription(researchCanvasConfigs);

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

              const researchQuestion = "Lifespan of penguins";
              await page
                .getByPlaceholder("Enter your research question")
                .fill(researchQuestion);

              await sendChatMessage(
                page,
                "Conduct research based on my research question, please. DO NOT FORGET TO PRODUCE THE DRAFT AT THE END!"
              );

              await waitForSteps(page);
              await waitForResponse(page);

              // Ensure research draft
              const researchDraft = await page.locator(
                '[data-test-id="research-draft"]'
              );
              const draftContent = await researchDraft.textContent();
              expect(draftContent).not.toBe("");

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
            });
          });
        });
      });
    });
  });
});
