import playwright from "../../showcase/integrations/built-in-agent/node_modules/playwright/index.js";
const { chromium } = playwright;

const captured = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.route("**/api/copilotkit-agent-config**", async (route) => {
  const request = route.request();
  if (request.method() !== "POST") return route.continue();
  const body = request.postDataJSON();
  if (body.method === "info") return route.continue();
  const input = body.body ?? body.params?.body ?? body.params ?? body;
  captured.push({
    method: body.method ?? null,
    topLevelKeys: Object.keys(body).sort(),
    inputKeys: Object.keys(input).sort(),
    forwardedProps: input.forwardedProps ?? null,
    context: input.context ?? null,
    lastMessage: Array.isArray(input.messages)
      ? (input.messages.at(-1)?.content ?? null)
      : null,
  });
  await route.abort("failed");
});
await page.goto("http://127.0.0.1:3127/demos/agent-config", {
  waitUntil: "networkidle",
});
await page
  .locator('[data-testid="agent-config-tone-select"]')
  .selectOption("enthusiastic");
await page
  .locator('[data-testid="agent-config-expertise-select"]')
  .selectOption("expert");
await page
  .locator('[data-testid="agent-config-length-select"]')
  .selectOption("detailed");
await page
  .getByPlaceholder("Type a message")
  .fill("AUDIT_NEUTRAL_SENTINEL_BIA_7f3c9a");
await page.getByPlaceholder("Type a message").press("Enter");
await page.waitForFunction(
  () =>
    document.querySelectorAll('[data-testid="copilot-chat-textarea"]').length >
    0,
);
for (let attempt = 0; attempt < 40 && captured.length === 0; attempt++) {
  await page.waitForTimeout(100);
}
await browser.close();
if (captured.length === 0) throw new Error("no POST captured");
console.log(JSON.stringify({ captured }, null, 2));
