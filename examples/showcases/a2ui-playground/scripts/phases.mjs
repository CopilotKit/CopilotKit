/** Screenshots the playground every STEP ms after sending a prompt, to check the three build phases. */
import puppeteer from "puppeteer-core";
const [, , prompt = "Q3 sales by region as a dashboard", mode = "dynamic", prefix = "/tmp/phase"] = process.argv;
const STEP = Number(process.env.STEP ?? 400), N = Number(process.env.N ?? 12), W = Number(process.env.W ?? 1440);
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle"], defaultViewport: { width: W, height: 900, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.goto(process.env.URL ?? "http://localhost:3100/playground", { waitUntil: "networkidle2" });
await p.evaluate((m) => window.__setMode?.(m), mode);
await new Promise((r) => setTimeout(r, 400));
const ta = await p.waitForSelector("textarea"); await ta.click(); await ta.type(prompt); await p.keyboard.press("Enter");
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  await new Promise((r) => setTimeout(r, STEP));
  await p.screenshot({ path: `${prefix}-${String(i).padStart(2, "0")}.png` });
  console.log(i, Date.now() - t0, await p.evaluate(() => document.querySelectorAll(".a2-blueprint").length + " bp, locked " + document.querySelectorAll('.a2-blueprint[data-state="locked"]').length + ", build " + (document.querySelector("[data-build]")?.getAttribute("data-build") ?? "-")));
}
await b.close();
