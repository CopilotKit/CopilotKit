/** Screenshots the landing replay at several clock points: node scripts/landing-shots.mjs <prefix> [chip index] */
import puppeteer from "puppeteer-core";
const [, , prefix = "/tmp/landing", chip = "0"] = process.argv;
const W = Number(process.env.W ?? 1440);
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle"], defaultViewport: { width: W, height: 1000, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.goto("http://localhost:3100/", { waitUntil: "networkidle2" });
const y = await p.evaluate(() => { const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("A real run")); return h.getBoundingClientRect().top + scrollY - 70; });
await p.evaluate((y) => scrollTo(0, y), y);
if (chip !== "0") await p.evaluate((i) => [...document.querySelectorAll("button[aria-pressed]")][i].click(), Number(chip));
else await p.evaluate(() => document.querySelector("button[aria-label='Restart']").click());
const t0 = Date.now();
for (const at of (process.env.AT ?? "1500,4200,6000,9000").split(",").map(Number)) {
  while (Date.now() - t0 < at) await new Promise((r) => setTimeout(r, 20));
  await p.screenshot({ path: `${prefix}-${at}.png` });
}
await b.close();
