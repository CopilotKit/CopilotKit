import { test, expect } from "@playwright/test";
import { waitForSteps, waitForResponse, sendChatMessage } from "../lib/helpers";
import urls from "../urls.json";
/*
  Only add urls that test needs
 */
const projectUrls = [
  urls["coagents-research-canvas-ui-deps-local"],
  urls["coagents-research-canvas-ui-deps-remote"],
];

const models = [{ name: "OpenAI", value: "openai" }];

test.beforeAll(async () => {
  const uiFetch = fetch(
    "https://zvmhdot5bsszoxog7hm3jt37ju0vaoah.lambda-url.us-east-1.on.aws/"
  );
  const agentFetch = fetch(
    "https://tc553nczoocujifiqugfqj4ukm0msijo.lambda-url.us-east-1.on.aws/copilotkit/info"
  );
  await Promise.all([uiFetch, agentFetch]);
  console.log("Warmed up all endpoints");
  console.log("URLS", urls);
});

test.describe("Canvas Researcher Demo", () => {
  projectUrls.forEach((projectUrl) => {
    models.forEach((model) => {
      test.skip(`Test ${projectUrl} with model ${model.name}`, async ({
        page,
      }) => {
        await page.goto(`${projectUrl}?coAgentsModel=${model.value}`);

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
