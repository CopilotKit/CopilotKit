/**
 * Records a build as a frame sequence: screenshots every 250 ms from the first
 * blueprint until the run finishes (max N frames).
 *   node scripts/build-frames.mjs <mode> "<prompt>" <prefix> [path=/playground] [maxFrames=12] [selector]
 */
import puppeteer from "puppeteer-core";
const [
  ,
  ,
  mode = "dynamic",
  prompt = "Q3 sales by region as a dashboard",
  prefix = "/tmp/a2ui-playground-shots/build-dynamic",
  path = "/playground",
  maxFrames = "12",
  selector = "",
] = process.argv;
const b = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-gl=angle"],
  defaultViewport: {
    width: Number(process.env.W ?? 1440),
    height: Number(process.env.H ?? 900),
    deviceScaleFactor: 1.5,
  },
});
const p = await b.newPage();
await p.goto(`http://localhost:3100${path}`, { waitUntil: "networkidle2" });
await p.evaluate((m) => window.__setMode?.(m), mode);
await new Promise((r) => setTimeout(r, 1200));
const ta = await p.waitForSelector("textarea");
await ta.click();
await ta.type(prompt);
await p.keyboard.press("Enter");
await p.waitForFunction(
  () =>
    document.querySelector(
      ".a2-surface-host .a2-blueprint, .a2-surface-host .a2-node",
    ),
  { timeout: 60000, polling: 50 },
);
const shots = [];
for (let i = 0; i < Number(maxFrames); i++) {
  const t = await p.evaluate(() => {
    const r = window.__runStore?.current();
    return r ? Math.round(performance.now() - r.startedAt) : 0;
  });
  const counts = await p.evaluate(() => ({
    frames: document.querySelectorAll(".a2-surface-host .a2-blueprint").length,
    nodes: document.querySelectorAll(".a2-surface-host .a2-node").length,
  }));
  const out = `${prefix}-${String(i).padStart(2, "0")}.png`;
  const target = selector ? await p.$(selector) : null;
  if (target) await target.screenshot({ path: out });
  else await p.screenshot({ path: out });
  shots.push(
    `${out}  t=${t}ms blueprints=${counts.frames} nodes=${counts.nodes}`,
  );
  const done = await p.evaluate(
    () => window.__runStore?.current()?.status !== "running",
  );
  if (done && i > 0) break;
  await new Promise((r) => setTimeout(r, 250));
}
console.log(shots.join("\n"));
await b.close();
