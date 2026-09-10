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
    await page.goto("http://127.0.0.1:3117/demos/voice", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const textarea = page.locator('[data-testid="copilot-chat-textarea"]');
    await textarea.waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("Try a sample audio", { exact: true }).click();
    await page.waitForTimeout(500);
    const afterSample = await textarea.inputValue();
    const buttons = await page.locator("button").evaluateAll((elements) =>
      elements
        .map((element) => ({
          text: (element.textContent || "").trim().slice(0, 120),
          disabled: element.disabled,
          ariaDisabled: element.getAttribute("aria-disabled"),
          type: element.getAttribute("type"),
        }))
        .filter((button) => button.text),
    );
    await textarea.press("Enter");
    await page.waitForTimeout(5000);
    const finalValue = await textarea.inputValue();
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
      target: "built-in-agent/voice",
      action: "click sample audio then press Enter in chat textarea",
      textareaAfterSample: afterSample,
      textareaAfterSubmit: finalValue,
      bodyAfterSubmit: bodyText.slice(0, 1000),
      buttons,
      nonStaticRequests: nonStatic,
      nonStaticResponses,
      consoleErrors,
    };
    fs.writeFileSync(
      "tasks/docs-feature-audit/built-in-agent-voice-browser-probe.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        textareaAfterSample: afterSample,
        textareaAfterSubmit: finalValue,
        nonStaticRequestCount: nonStatic.length,
        nonStaticResponseCount: nonStaticResponses.length,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
