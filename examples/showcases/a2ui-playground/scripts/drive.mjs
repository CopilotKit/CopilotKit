/**
 * Drives the real app in headless Chrome: sends prompts through the chat,
 * waits for the run to finish, records timings from the playground store,
 * and screenshots the page.
 *
 *   node scripts/drive.mjs "<prompt>" [mode=auto|fixed|dynamic] [out.png]
 */
import puppeteer from "puppeteer-core";

const [
  ,
  ,
  prompt = "weather in Lisbon",
  mode = "auto",
  out = "/tmp/a2ui-playground-shots/run.png",
  width = "1440",
  height = "900",
] = process.argv;
const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
  defaultViewport: {
    width: Number(width),
    height: Number(height),
    deviceScaleFactor: 2,
  },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(process.env.URL ?? "http://localhost:3100/playground", {
  waitUntil: "networkidle2",
  timeout: 120000,
});
await page.evaluate((m) => {
  window.__setMode?.(m);
  window.__a2uiMode = m;
}, mode);
await new Promise((r) => setTimeout(r, 400));
const ta = await page.waitForSelector("textarea", { timeout: 30000 });
await ta.click();
await ta.type(prompt);
await page.keyboard.press("Enter");
const t0 = Date.now();
await page.waitForFunction(
  () => {
    const r = window.__runStore?.current();
    return r && r.status !== "running";
  },
  { timeout: 120000, polling: 100 },
);
await new Promise((r) => setTimeout(r, 1500));
const run = await page.evaluate(() => {
  const r = window.__runStore.current();
  return {
    path: r.path,
    tool: r.tool,
    firstPaintMs: r.firstPaintMs,
    serverPaintMs: r.serverPaintMs,
    totalMs: r.totalMs,
    status: r.status,
    events: r.events.map(
      (e) => `${e.t}ms ${e.label}${e.detail ? ` (${e.detail})` : ""}`,
    ),
  };
});
await page.screenshot({ path: out, fullPage: false });
console.log(
  JSON.stringify(
    {
      prompt,
      mode,
      wallMs: Date.now() - t0,
      ...run,
      errors: errors.slice(0, 8),
    },
    null,
    2,
  ),
);
await browser.close();
