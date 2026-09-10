const fs = require("node:fs");
const { chromium } = require("../../showcase/harness/node_modules/playwright");

(async () => {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  const responses = [];
  const consoleErrors = [];
  page.on("request", (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );
  page.on("response", (response) =>
    responses.push({ status: response.status(), url: response.url() }),
  );
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await page.goto("http://127.0.0.1:3117/demos/multimodal", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.getByText("Try with sample image", { exact: true }).click();
    await page.waitForTimeout(6000);
    const bodyText = await page.locator("body").innerText();
    const nonStatic = requests.filter(
      (request) =>
        !request.url.includes("/_next/") &&
        !request.url.includes("fonts.") &&
        !request.url.includes("announcements."),
    );
    const nonStaticResponses = responses.filter(
      (response) =>
        !response.url.includes("/_next/") &&
        !response.url.includes("fonts.") &&
        !response.url.includes("announcements."),
    );
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      target: "built-in-agent/multimodal",
      action: "click sample image",
      bodyAfterClick: bodyText.slice(0, 1000),
      nonStaticRequests: nonStatic,
      nonStaticResponses,
      consoleErrors,
    };
    fs.writeFileSync(
      "tasks/docs-feature-audit/built-in-agent-multimodal-browser-probe.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        nonStaticRequestCount: nonStatic.length,
        nonStaticResponseCount: nonStaticResponses.length,
        hasFixtureError: bodyText.includes("No fixture matched"),
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
