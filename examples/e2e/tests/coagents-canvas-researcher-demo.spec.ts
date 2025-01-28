import { test, expect } from "@playwright/test";
import {
  waitForStepsAndEnsureStreaming,
  waitForResponse,
  sendChatMessage,
  waitForSuggestions,
} from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
  TestVariants,
  appendLGCVariants,
} from "../lib/config-helper";

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const variants: TestVariants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
];

if (
  process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL &&
  process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY
) {
  variants.push({
    name: "Copilot Cloud (Staging)",
    queryParams: `?runtimeUrl=${process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL}&publicApiKey=${process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY}`,
    isCloud: true,
  });
}

if (
  process.env.COPILOT_CLOUD_PRODUCTION_RUNTIME_URL &&
  process.env.COPILOT_CLOUD_PRODUCTION_PUBLIC_API_KEY
) {
  variants.push({
    name: "Copilot Cloud (Production)",
    queryParams: `?runtimeUrl=${process.env.COPILOT_CLOUD_PRODUCTION_RUNTIME_URL}&publicApiKey=${process.env.COPILOT_CLOUD_PRODUCTION_PUBLIC_API_KEY}`,
    isCloud: true,
  });
}

// Get configurations
const allConfigs = getConfigs();
const researchCanvasConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_RESEARCH_CANVAS
);
const groupedConfigs = groupConfigsByDescription(researchCanvasConfigs);

const cloudVariants = variants.filter((variant) => variant.isCloud);
const nonCloudVariants = variants.filter((variant) => !variant.isCloud);

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
              await page.goto(`${config.url}${variant.queryParams}`);
              await waitForSuggestions(page, 3);
              const researchQuestion = "Lifespan of penguins";
              await page
                .getByPlaceholder("Enter your research question")
                .fill(researchQuestion);

              await sendChatMessage(
                page,
                "Conduct research based on my research question, please. DO NOT FORGET TO PRODUCE THE DRAFT AT THE END!"
              );

              await waitForStepsAndEnsureStreaming(page);
              await waitForResponse(page);

              // Ensure research draft
              const researchDraft = await page.locator(
                '[data-test-id="research-draft"]'
              );
              const draftContent = await researchDraft.textContent();

              try {
                expect(draftContent).not.toBe("");
              } catch (e) {
                // Sometimes the LLM does not fill the draft. We will attempt a retry at filling it.
                await sendChatMessage(
                  page,
                  "The draft seems to be empty, please fill it in."
                );
                await waitForStepsAndEnsureStreaming(page);
                await waitForResponse(page);

                const draftContent = await researchDraft.textContent();
                expect(draftContent).not.toBe("");
              }

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
