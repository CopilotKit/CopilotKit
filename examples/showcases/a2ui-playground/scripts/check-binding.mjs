/**
 * Two-way binding smoke test for the Inputs catalog previews.
 *   node scripts/check-binding.mjs [outDir]
 * Toggles the Switch and a ChipSelect chip, waits for the Gen UI 2.0 round
 * trip (setValue -> data model -> resolved props), and confirms the DOM still
 * reflects the edit. Also screenshots open popovers. (TextField is a standard
 * Gen UI 2.0 component now, with no catalog page of its own.)
 */
import puppeteer from "puppeteer-core";
import { openComponent } from "./lib-components.mjs";
const [, , outDir = "/tmp/a2ui-playground-shots"] = process.argv;
const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 1100, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { model: {} };

// Prove the write reached the data model: walk up the React fiber from the DOM
// node to the renderer and read the engine-resolved `props.value` (which only
// changes when the A2UI data model changes; local state lives elsewhere).
const modelValue = (sel) =>
  page.$eval(sel, (el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    let f = key ? el[key] : null;
    while (f) {
      const p = f.memoizedProps?.props;
      if (p && typeof p === "object" && "setValue" in p)
        return { value: p.value, hasSetter: typeof p.setValue === "function" };
      f = f.return;
    }
    return null;
  });

// Switch: was false, click once.
await openComponent(page, "Switch");
const before = await page.$eval(
  '[data-preview="Switch"] [role="switch"]',
  (el) => el.getAttribute("aria-checked"),
);
await page.click('[data-preview="Switch"] [role="switch"]');
await sleep(600);
const after = await page.$eval(
  '[data-preview="Switch"] [role="switch"]',
  (el) => el.getAttribute("aria-checked"),
);
results.switch = { before, after };
results.model.switch = await modelValue(
  '[data-preview="Switch"] [role="switch"]',
);

// ChipSelect: add "Billing".
await openComponent(page, "ChipSelect");
const chips = await page.$$('[data-preview="ChipSelect"] button');
for (const c of chips)
  if ((await c.evaluate((e) => e.textContent?.trim())) === "Billing")
    await c.click();
await sleep(600);
results.chips = await page.$$eval(
  '[data-preview="ChipSelect"] button[data-state="on"]',
  (els) => els.map((e) => e.textContent?.trim()),
);

results.model.chips = await modelValue('[data-preview="ChipSelect"] button');

const ok =
  results.model.switch?.value === true &&
  JSON.stringify(results.model.chips?.value) ===
    JSON.stringify(["deploys", "incidents", "billing"]) &&
  before === "false" &&
  after === "true" &&
  results.chips.includes("Billing") &&
  results.chips.length === 3;

// Popovers: Combobox and DatePicker.
await openComponent(page, "Combobox");
await page.click('[data-preview="Combobox"] button[role="combobox"]');
await sleep(500);
await page.keyboard.type("tok");
await sleep(400);
await page.screenshot({ path: `${outDir}/catalog-inputs-combobox.png` });
await page.keyboard.press("Enter");
await sleep(500);
results.combobox = await page.$eval(
  '[data-preview="Combobox"] button[role="combobox"]',
  (el) => el.textContent?.trim(),
);
await openComponent(page, "DatePicker");
await page.click('[data-preview="DatePicker"] button');
await sleep(500);
await page.screenshot({ path: `${outDir}/catalog-inputs-datepicker.png` });

console.log(
  JSON.stringify(
    {
      ok: ok && results.combobox === "Tokyo",
      results,
      errors: errors.slice(0, 10),
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(ok ? 0 : 1);
