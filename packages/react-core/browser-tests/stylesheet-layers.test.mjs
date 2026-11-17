import assert from "node:assert/strict";
import { after as afterAll, before as beforeAll, test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// How CopilotKit's CSS meets an app's CSS. The component styles are outside
// cascade layers, with the specificity of two element selectors: a global
// reset (`*`, `button`, `p`) loses to them, and any class rule of the app
// wins. The theme variables are in the `base` layer. jsdom has no cascade
// layers, so this runs in Chromium.

const here = path.dirname(fileURLToPath(import.meta.url));
let stylesheet;
let browser;

// Global resets that apps ship outside a cascade layer.
const resets = {
  // create-next-app's globals.css.
  next: `* { box-sizing: border-box; padding: 0; margin: 0; }`,
  // The element rules of Tailwind v3's preflight, Bootstrap's reboot, and
  // normalize.css that meet CopilotKit's buttons.
  elements: `
    button { padding: 0; border-radius: 0; font-size: 100%; line-height: 1.15;
      font-weight: inherit; background-color: transparent; display: block; }
  `,
};

// The parts of a Tailwind v4 build that meet CopilotKit's CSS: the layer
// order, a preflight-style reset in `base`, theme overrides, and utilities.
const tailwindApp = `
@layer theme, base, components, utilities;
@layer base {
  *, ::before, ::after { margin: 0; padding: 0; border: 0 solid; }
  button { font: inherit; background-color: transparent; }
  [data-copilotkit] { --radius: 3px; }
}
@layer utilities {
  .text-lg { font-size: 18px; }
  .text-lg\\! { font-size: 18px !important; }
  .p-6 { padding: 24px; }
}
`;
const plainApp = `
[data-copilotkit] { --primary: rgb(255, 0, 0); }
.app-send-button { font-size: 20px; }
`;
// The same theme overrides, with no reset.
const themeOnly = `
@layer base { [data-copilotkit] { --radius: 3px; } }
[data-copilotkit] { --primary: rgb(255, 0, 0); }
`;

beforeAll(async () => {
  const source = await readFile(
    path.join(here, "../../core/src/styles/stylesheet.ts"),
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
        <button class="cpk-button cpk-button-default cpk-button-size-default" id="ours">Send</button>
        <div class="p-6" id="app-element">An element the app renders in a slot</div>
        <button class="cpk-button text-lg" id="utility">Send</button>
        <button class="cpk-button text-lg!" id="important-utility">Send</button>
        <button class="cpk-button app-send-button" id="app-class">Send</button>
      </div>
    </body></html>`);
  const result = await page.evaluate(() => {
    const root = document.getElementById("root");
    const style = (id) => getComputedStyle(document.getElementById(id));
    const ours = style("ours");
    return {
      ours: {
        display: ours.display,
        fontSize: ours.fontSize,
        fontWeight: ours.fontWeight,
        borderRadius: ours.borderRadius,
        paddingLeft: ours.paddingLeft,
        backgroundColor: ours.backgroundColor,
      },
      utilityFontSize: style("utility").fontSize,
      importantUtilityFontSize: style("important-utility").fontSize,
      appClassFontSize: style("app-class").fontSize,
      appElementPadding: style("app-element").paddingLeft,
      primary: getComputedStyle(root).getPropertyValue("--primary").trim(),
      radius: getComputedStyle(root).getPropertyValue("--radius").trim(),
    };
  });
  await page.close();
  return result;
}

const appStyles = [resets.next, resets.elements, tailwindApp, plainApp];
let baseline;

test("baseline: CopilotKit CSS with the app's theme overrides", async () => {
  baseline = (await render([stylesheet, themeOnly])).ours;
  assert.equal(baseline.display, "inline-flex");
  assert.equal(baseline.fontSize, "14px");
  assert.notEqual(baseline.paddingLeft, "0px");
  assert.notEqual(baseline.borderRadius, "0px");
  assert.equal(baseline.backgroundColor, "rgb(255, 0, 0)");
});

for (const [order, styles] of [
  ["before the app's CSS", () => [stylesheet, ...appStyles]],
  ["after the app's CSS", () => [...appStyles, stylesheet]],
]) {
  test(`CopilotKit CSS loaded ${order}`, async () => {
    const result = await render(styles());

    // Global resets, in a layer or outside one, change nothing.
    assert.deepEqual(result.ours, baseline);
    // The app's class rules win.
    assert.equal(result.appClassFontSize, "20px");
    // A Tailwind v4 utility is in a layer, so it needs `!` to win.
    assert.equal(result.utilityFontSize, "14px");
    assert.equal(result.importantUtilityFontSize, "18px");
    // Theme overrides win, in the `base` layer or outside a layer.
    assert.equal(result.primary, "rgb(255, 0, 0)");
    assert.equal(result.radius, "3px");
  });
}

// A Tailwind app has no reset outside a layer. A utility class on an element
// the app renders inside the chat, such as a custom slot, beats CopilotKit's
// scoped reset.
for (const [order, styles] of [
  ["before", () => [stylesheet, tailwindApp]],
  ["after", () => [tailwindApp, stylesheet]],
]) {
  test(`a Tailwind class styles the app's elements in the chat (CopilotKit CSS ${order})`, async () => {
    const result = await render(styles());
    assert.equal(result.appElementPadding, "24px");
  });
}

// The create-vite React starter centers all text in `#root`, which wraps the
// chat. The chat keeps its own alignment.
test("the chat does not inherit the page's text alignment", async () => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head>
    <style>${stylesheet}</style>
    <style>#app { text-align: center; }</style>
    </head><body>
      <div id="app">
        <div data-copilotkit id="chat"><p id="message">ANANAB</p></div>
      </div>
    </body></html>`);
  const alignment = await page.evaluate(
    () => getComputedStyle(document.getElementById("message")).textAlign,
  );
  await page.close();
  assert.equal(alignment, "start");
});
