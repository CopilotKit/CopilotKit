/**
 * Screenshot any page in headless Chrome and report console errors.
 *   node scripts/shot.mjs "/components/BarChart" /tmp/a2ui-playground-shots/x.png [width] [waitMs]
 */
import puppeteer from "puppeteer-core";
const [
  ,
  ,
  path = "/",
  out = "shot.png",
  width = "1440",
  wait = "2500",
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
    deviceScaleFactor: Number(process.env.SCALE ?? 1.5),
  },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    errors.push(`${m.type()}: ${m.text()}`.slice(0, 300));
});
await page.goto(`${process.env.BASE ?? "http://localhost:3100"}${path}`, {
  waitUntil: "networkidle2",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, Number(wait)));
await page.screenshot({ path: out, fullPage: true });
const failures = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="alert"]'))
    .map((e) => e.textContent)
    .slice(0, 20),
);
console.log(
  JSON.stringify(
    { out, errors: errors.slice(0, 15), componentFailures: failures },
    null,
    2,
  ),
);
await browser.close();
