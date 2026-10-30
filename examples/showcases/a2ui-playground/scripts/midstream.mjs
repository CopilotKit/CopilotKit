/** Screenshots a dynamic surface while it is still streaming (progressive paint). */
import puppeteer from "puppeteer-core";
const [, , prompt = "Q3 sales by region as a dashboard", out = "/tmp/a2ui-playground-shots/streaming-midway.png"] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle"], defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
const p = await b.newPage();
await p.goto("http://localhost:3100/playground", { waitUntil: "networkidle2" });
await p.evaluate(() => window.__setMode?.("dynamic"));
await new Promise((r) => setTimeout(r, 400));
const ta = await p.waitForSelector("textarea"); await ta.click(); await ta.type(prompt); await p.keyboard.press("Enter");
await p.waitForFunction(() => { const s = Object.values(window.__runStore?.get().surfaces ?? {}).at(-1); return s && s.componentCount >= 6 && window.__runStore.current().status === "running"; }, { timeout: 60000, polling: 50 });
await p.screenshot({ path: out });
console.log("captured", out);
await b.close();
