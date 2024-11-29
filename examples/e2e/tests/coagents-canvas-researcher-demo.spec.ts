import { test, expect } from "@playwright/test";
import { waitForStepsAndEnsureStreaming, waitForResponse, sendChatMessage } from "../lib/helpers";
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
          appendLGCVariants(
            {
              ...config,
              lgcJSDeploymentUrl:
              config.lgcJSDeploymentUrl ??
                "https://coagents-research-canvas-st-08476feebc3a58e5925116da0d3ad635.default.us.langgraph.app",
            },
            variants
          ).forEach((variant) => {
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
