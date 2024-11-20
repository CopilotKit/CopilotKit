import { test, expect } from "@playwright/test";
import { waitForSteps, waitForResponse, sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
} from "../lib/config-helper";

const models = [
  { name: "OpenAI", value: "openai" },
  { name: "Anthropic", value: "anthropic" },
  { name: "Google Generative AI", value: "google_genai" },
];

test.beforeAll(async () => {
  const uiFetch = fetch(
    "https://zvmhdot5bsszoxog7hm3jt37ju0vaoah.lambda-url.us-east-1.on.aws/"
  );
  const agentFetch = fetch(
    "https://tc553nczoocujifiqugfqj4ukm0msijo.lambda-url.us-east-1.on.aws/copilotkit/info"
  );
  await Promise.all([uiFetch, agentFetch]);
  console.log("Warmed up all endpoints");
});

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
          models.forEach((model) => {
            test(`Test ${config.description} with model ${model.name}`, async ({
              page,
            }) => {
              await page.goto(`${config.url}?coAgentsModel=${model.value}`);

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
