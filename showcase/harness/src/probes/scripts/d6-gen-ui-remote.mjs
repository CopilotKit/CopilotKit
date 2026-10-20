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
const diagnostics = {
  requests: [],
  eventTypes: Object.create(null),
  runErrors: [],
  pageErrors: [],
  requestFailures: [],
};
const boundedText = (value) =>
  String(value ?? "")
    .replace(/https?:\/\/\S+/g, "[URL]")
    .replace(/\b(?:sk-\S+|Bearer\s+\S+)/gi, "[redacted]")
    .slice(0, 500);
const record = (items, value) => {
  if (items.length < 20) items.push(value);
};
let page;
try {
  page = await browser.newPage();
  page.on("pageerror", (error) => {
    record(diagnostics.pageErrors, boundedText(error.message));
  });
  page.on("requestfailed", (request) => {
    record(diagnostics.requestFailures, {
      resourceType: request.resourceType(),
      error: boundedText(request.failure()?.errorText),
    });
  });
  const operations = [];
  await page.route("**/api/copilotkit-declarative-gen-ui", async (route) => {
    const method = route.request().postDataJSON()?.method;
    const request = {
      httpMethod: route.request().method(),
      method: boundedText(method),
      status: null,
    };
    record(diagnostics.requests, request);
    const response = await route.fetch({ url: remoteUrl, timeout: 90_000 });
    request.status = response.status();
    const body = await response.text();
    if (method === "agent/run") {
      for (const line of body.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        const type = boundedText(event.type);
        if (
          Object.hasOwn(diagnostics.eventTypes, type) ||
          Object.keys(diagnostics.eventTypes).length < 50
        ) {
          diagnostics.eventTypes[type] =
            (diagnostics.eventTypes[type] ?? 0) + 1;
        }
        if (event.type === "RUN_ERROR") {
          record(diagnostics.runErrors, {
            code: boundedText(event.code),
            message: boundedText(event.message),
          });
        }
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
  // The textarea is usable before the agent is ready; the send button waits
  // until CopilotChat has installed its submission callback.
  await page.getByTestId("copilot-send-button").click({ timeout: 90_000 });
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
} catch (error) {
  diagnostics.composerContainsPrompt = await page
    ?.getByPlaceholder("Type a message")
    .inputValue({ timeout: 1_000 })
    .then((value) => value === prompt)
    .catch(() => null);
  console.error(
    "Remote A2UI failure diagnostics:",
    JSON.stringify(diagnostics),
  );
  throw error;
} finally {
  await browser.close();
}
