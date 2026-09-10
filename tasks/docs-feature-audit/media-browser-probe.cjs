const fs = require("node:fs");
const { chromium } = require("../../showcase/harness/node_modules/playwright");
const [slug, port, feature, waitMsArg] = process.argv.slice(2);
const waitMs = Number(waitMsArg || 6000);
if (!slug || !port || !["voice", "multimodal"].includes(feature))
  throw new Error(
    "usage: media-browser-probe.cjs <slug> <port> <voice|multimodal>",
  );
(async () => {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const blocked = [],
    requests = [],
    responses = [],
    consoleErrors = [],
    apiBodies = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      return route.continue();
    blocked.push(url.href);
    return route.abort("blockedbyclient");
  });
  page.on("request", (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );
  page.on("response", async (response) => {
    responses.push({ status: response.status(), url: response.url() });
    if (response.url().includes("/api/copilotkit-multimodal")) {
      try {
        const text = await response.text();
        apiBodies.push({
          url: response.url(),
          status: response.status(),
          responseKind: text.startsWith("data:") ? "ag-ui-sse" : "metadata",
          responseLength: text.length,
          hasRunStarted: text.includes('"type":"RUN_STARTED"'),
          hasFixtureNoMatch: text.includes("No fixture matched"),
          hasInternalError: text.includes("internal error"),
          hasImageData: text.includes('"type":"image"'),
        });
      } catch (error) {
        apiBodies.push({ url: response.url(), error: String(error) });
      }
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    await page.goto(`${base}/demos/${feature}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    let action;
    if (feature === "voice") {
      const textarea = page.locator('[data-testid="copilot-chat-textarea"]');
      await textarea.waitFor({ state: "visible", timeout: 15000 });
      await page.getByText("Try a sample audio", { exact: true }).click();
      await page.waitForTimeout(400);
      const afterSample = await textarea.inputValue();
      await textarea.press("Enter");
      action = { kind: "sample-audio-enter", textareaAfterSample: afterSample };
    } else {
      await page.getByText("Try with sample image", { exact: true }).click();
      action = { kind: "sample-image-click" };
    }
    await page.waitForTimeout(waitMs);
    const body = await page.locator("body").innerText();
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      target: `${slug}/${feature}`,
      action,
      localOnlyNetworkBlock: true,
      blockedRemoteUrls: [...new Set(blocked)],
      bodyAfterAction: body.slice(0, 1200),
      requests,
      responses,
      apiBodies,
      consoleErrors,
    };
    const file = `tasks/docs-feature-audit/${slug}-${feature}-localonly-${waitMs}ms-browser-probe.json`;
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
    console.log(
      JSON.stringify({
        target: result.target,
        fixtureError: body.includes("No fixture matched"),
        localRequests: requests.filter(
          (r) => r.url.includes("127.0.0.1") || r.url.includes("localhost"),
        ).length,
        blockedRemote: result.blockedRemoteUrls.length,
        file,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
