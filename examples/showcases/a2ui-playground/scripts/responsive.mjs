/** Screenshots the shell at narrower widths: home, after a run, and with the inspector drawer open. */
import puppeteer from "puppeteer-core";
const widths = (process.argv[2] ?? "1280,1024").split(",").map(Number);
const prompt = process.argv[3] ?? "Q3 sales by region as a dashboard";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle"] });
for (const w of widths) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: 800, deviceScaleFactor: 2 });
  await p.goto("http://localhost:3100/playground", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));
  await p.screenshot({ path: `/tmp/a2ui-playground-shots/responsive-${w}-home.png` });
  const ta = await p.waitForSelector("textarea"); await ta.click(); await ta.type(prompt); await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__runStore?.current()?.status === "done", { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await p.screenshot({ path: `/tmp/a2ui-playground-shots/responsive-${w}-run.png` });
  const streamBtn = await p.evaluateHandle(() => [...document.querySelectorAll("button")].find((x) => x.textContent === "stream" && x.closest("section")));
  if (streamBtn && (await streamBtn.evaluate((x) => !!x))) {
    await streamBtn.click();
    await new Promise((r) => setTimeout(r, 600));
    await p.screenshot({ path: `/tmp/a2ui-playground-shots/responsive-${w}-drawer.png` });
  }
  console.log(`width ${w}: horizontal overflow=${overflow}`);
  await p.close();
}
await b.close();
