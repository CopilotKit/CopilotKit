/** Minimal path check: /minimal uses a stock BuiltInAgent + catalog on the provider (runtime-injected render tool). */
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1.5 },
});
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto("http://localhost:3100/minimal", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));
const ta = await p.waitForSelector("textarea");
await ta.click();
await ta.type(
  "Show three KPI stats: MRR $84.2k up 6%, 1,912 customers, churn 2.1%",
);
await new Promise((r) => setTimeout(r, 300));
await p.click('[data-testid="copilot-send-button"]');
const t0 = Date.now();
await p
  .waitForFunction(() => document.querySelectorAll(".a2-card").length >= 3, {
    timeout: 90000,
    polling: 200,
  })
  .catch(() => errs.push("no surface within 90s"));
const paint = Date.now() - t0;
await p
  .waitForFunction(
    () => document.querySelector('[data-copilot-running="false"]'),
    { timeout: 60000, polling: 200 },
  )
  .catch(() => {});
await new Promise((r) => setTimeout(r, 1000));
console.log(
  JSON.stringify({
    paintMs: paint,
    totalMs: Date.now() - t0,
    cards: await p.evaluate(() => document.querySelectorAll(".a2-card").length),
    errs,
  }),
);
await p.screenshot({ path: "/tmp/a2ui-playground-shots/minimal-injected.png" });
await b.close();
