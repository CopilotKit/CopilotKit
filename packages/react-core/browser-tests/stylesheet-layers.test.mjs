import assert from "node:assert/strict";
import { after as afterAll, before as beforeAll, test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// The CopilotKit stylesheet sits in Tailwind v4's cascade layers, so an app's
// own CSS overrides it and an app's reset does not. jsdom has no cascade
// layers, so this runs in Chromium.

const here = path.dirname(fileURLToPath(import.meta.url));
let stylesheet;
let browser;

// The parts of a Tailwind v4 build that meet CopilotKit's CSS: the layer
// order, a preflight-style reset in `base`, and a utility class.
const tailwindApp = `
@layer theme, base, components, utilities;
@layer base {
  *, ::before, ::after { margin: 0; padding: 0; border: 0 solid; }
  button { font: inherit; background-color: transparent; }
  [data-copilotkit] { --radius: 3px; }
}
@layer utilities {
  .text-lg { font-size: 18px; }
}
`;
const plainApp = `[data-copilotkit] { --primary: rgb(255, 0, 0); }`;

beforeAll(async () => {
  const source = await readFile(
    path.join(here, "../src/v2/styles/stylesheet.ts"),
    "utf8",
  );
  stylesheet = JSON.parse(source.match(/= (".*");/s)[1]);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
});

afterAll(async () => {
  await browser?.close();
});

async function render(styles) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head>
    ${styles.map((css) => `<style>${css}</style>`).join("\n")}
    </head><body>
      <div data-copilotkit id="root">
        <button class="cpk-button" id="ours">Send</button>
        <button class="cpk-button text-lg" id="overridden">Send</button>
      </div>
    </body></html>`);
  const result = await page.evaluate(() => {
    const root = document.getElementById("root");
    const style = (id) => getComputedStyle(document.getElementById(id));
    return {
      ourFontSize: style("ours").fontSize,
      ourDisplay: style("ours").display,
      utilityFontSize: style("overridden").fontSize,
      primary: getComputedStyle(root).getPropertyValue("--primary").trim(),
      radius: getComputedStyle(root).getPropertyValue("--radius").trim(),
    };
  });
  await page.close();
  return result;
}

for (const [order, styles] of [
  ["before the app's CSS", () => [stylesheet, tailwindApp, plainApp]],
  ["after the app's CSS", () => [tailwindApp, plainApp, stylesheet]],
]) {
  test(`CopilotKit CSS loaded ${order}`, async () => {
    const result = await render(styles());

    // Beats the app's reset in the `base` layer.
    assert.equal(result.ourFontSize, "14px");
    assert.equal(result.ourDisplay, "inline-flex");
    // Loses to the app's utility class, its unlayered CSS, and its `base`
    // layer token overrides.
    assert.equal(result.utilityFontSize, "18px");
    assert.equal(result.primary, "rgb(255, 0, 0)");
    assert.equal(result.radius, "3px");
  });
}
