import { test, expect } from "@playwright/test";
import { waitForSteps, waitForResponse, sendChatMessage } from "../lib/helpers";

const models = [
  { name: "OpenAI", value: "openai" },
]

test.beforeAll(async () => {
  // Simple HTTP calls to eliminate cold start in the apps
  const uiFetch = fetch("https://zvmhdot5bsszoxog7hm3jt37ju0vaoah.lambda-url.us-east-1.on.aws/");
  const agentFetch = fetch("https://tc553nczoocujifiqugfqj4ukm0msijo.lambda-url.us-east-1.on.aws/copilotkit/info")
  await Promise.all([uiFetch, agentFetch]);
  console.log("Warmed up all endpoints");
});

test.describe("Canvas Researcher Demo", () => {
  models.forEach(model => {
    test(`End-to-end test with model ${model.name}`, async ({ page }) => {
      
      await page.goto(`http://localhost:3000?coAgentsModel=${model.value}`)
      // Type in research question
      await page.getByPlaceholder('Enter your research question').fill('Lifespan of penguins');
    
      // Ask AI to conduct research
      await sendChatMessage(page, "Conduct research based on my research question, please")
  
      // Ensure intermediate state (steps) is rendered
      await waitForSteps(page);
  
      // Wait for response
      await waitForResponse(page);
    
      // Count number of resources
      const resourceCount = await page.locator('[data-test-id="resource"]').count();
    
      // Ask AI to delete a resource
      await sendChatMessage(page, `Delete the first resource, please`);
    
      // Expect delete confirmation Generative UI component in chat
      await page.locator('[data-test-id="delete-resource-generative-ui-container"]');
    
      // Click "Delete" to confirm deletion
      await page.locator('button:has-text("Delete")').click();
    
      // Wait for response completion
      await waitForResponse(page);
    
      // Count for number of resources, it should be -1
      const newResourceCount = await page.locator('[data-test-id="resource"]').count();
      expect(newResourceCount).toBe(resourceCount - 1);
      
      await page.keyboard.press('Enter');
    });

  })

})

