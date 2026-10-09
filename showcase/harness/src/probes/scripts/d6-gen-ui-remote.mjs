// Exercise any declarative-gen-ui frontend against a separate CopilotKit route.
// FRONTEND_URL and REMOTE_COPILOTKIT_URL are required; PROMPT is optional.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const frontendUrl = process.env.FRONTEND_URL;
const remoteUrl = process.env.REMOTE_COPILOTKIT_URL;
const prompt =
  process.env.PROMPT ?? "Show me my sales dashboard for this quarter.";
if (!frontendUrl || !remoteUrl) {
  throw new Error("Set FRONTEND_URL and REMOTE_COPILOTKIT_URL");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const operations = [];
  await page.route("**/api/copilotkit-declarative-gen-ui", async (route) => {
    const response = await route.fetch({ url: remoteUrl, timeout: 90_000 });
    const body = await response.text();
    if (route.request().postDataJSON()?.method === "agent/run") {
      for (const line of body.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "ACTIVITY_SNAPSHOT") {
          operations.push(...(event.content?.a2ui_operations ?? []));
        }
      }
    }
    await route.fulfill({ response });
  });

  await page.goto(new URL("/demos/declarative-gen-ui", frontendUrl).href);
  const input = page.getByPlaceholder("Type a message");
  await input.fill(prompt);
  await input.press("Enter");
  await page.getByText("QUARTERLY REVENUE").waitFor({ timeout: 90_000 });

  const body = await page.locator("body").innerText();
  assert.match(body, /\$4\.2M/);
  assert.doesNotMatch(body, /Building Interface/);

  const components = operations.flatMap(
    (op) => op.updateComponents?.components ?? [],
  );
  assert.ok(components.length > 1, "nonempty updateComponents operation");
  assert.ok(components.some((component) => component.id === "root"));
  assert.ok(
    components.some(
      (component) =>
        component.component === "PieChart" &&
        component.data?.some((item) => item.label === "North America"),
    ),
    "chart component includes data",
  );
  console.log("Remote A2UI surface rendered with components and chart data.");
} finally {
  await browser.close();
}
