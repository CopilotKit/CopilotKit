/**
 * Records a real run for the workbench's first-visit replay: every surface
 * snapshot with its time since the prompt, the event timeline, and the lines
 * the model wrote (`lines`, also `line` on each op event), which the replay
 * shows as they were written.
 *   node scripts/record-replay.mjs [mode] "<prompt>" [out=src/data/replay.json]
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";
const [, , mode = "dynamic", prompt = "Q3 sales by region as a dashboard", out = "src/data/replay.json"] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, defaultViewport: { width: 1440, height: 900 } });
const p = await b.newPage();
await p.goto("http://localhost:3100/", { waitUntil: "networkidle2" });
await p.evaluate((m) => window.__setMode?.(m), mode);
await new Promise((r) => setTimeout(r, 1000));
const ta = await p.waitForSelector("#wb-prompt");
await ta.click();
await ta.type(prompt);
await p.keyboard.press("Enter");
await p.waitForFunction(() => window.__runStore?.current()?.status === "done", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const run = await p.evaluate(() => {
  const r = window.__runStore.current();
  return { prompt: r.prompt, mode: r.mode, model: r.model, format: r.format, path: r.path, tool: r.tool, firstFrameMs: r.firstFrameMs, firstPaintMs: r.firstPaintMs, totalMs: r.totalMs, tps: r.tps, tokens: r.tokens, events: r.events, lines: r.lines, frames: r.frames };
});
// Keep only snapshots that changed what is on screen.
const frames = [];
let last = "";
for (const f of run.frames) {
  const sig = JSON.stringify(f.ops);
  if (sig === last) continue;
  last = sig;
  frames.push({ t: f.t, ops: f.ops });
}
const data = { ...run, frames, recordedAt: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(out, JSON.stringify(data));
console.log(`${out}: ${frames.length} frames, ${run.events.length} events, ${run.lines.length} lines, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, first frame ${run.firstFrameMs} ms, content ${run.firstPaintMs} ms, total ${run.totalMs} ms`);
await b.close();
