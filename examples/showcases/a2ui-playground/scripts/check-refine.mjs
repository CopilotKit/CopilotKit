/**
 * Refinement actions update the SAME surface: ask for flights, click "Nonstop only",
 * and check no new card was added and the original card changed.
 */
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
const p = await b.newPage();
await p.goto("http://localhost:3100/playground", { waitUntil: "networkidle2" });
const ta = await p.waitForSelector("textarea"); await ta.click(); await ta.type("Flights from SFO to JFK on Friday"); await p.keyboard.press("Enter");
await p.waitForFunction(() => window.__runStore?.current()?.status === "done", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1000));
const before = await p.evaluate(() => {
  const s = window.__runStore.get();
  return { cards: document.querySelectorAll(".pg-chat .a2-surface-host").length, surfaces: s.surfaceOrder.length, flightCards: document.querySelectorAll(".pg-chat .a2-surface-host").length };
});
const btn = await p.evaluateHandle(() => [...document.querySelectorAll(".pg-chat .a2-surface-host button")].find((x) => x.textContent?.includes("Nonstop only")));
const runs = await p.evaluate(() => window.__runStore.get().runs.length);
await btn.click();
await p.waitForFunction((n) => window.__runStore.get().runs.length > n && window.__runStore.current().status !== "running", { timeout: 90000 }, runs);
await new Promise((r) => setTimeout(r, 1500));
const after = await p.evaluate(() => {
  const s = window.__runStore.get();
  const r = s.runs.at(-1);
  return {
    cards: document.querySelectorAll(".pg-chat .a2-surface-host").length,
    surfaces: s.surfaceOrder.length,
    run: { prompt: r.prompt, path: r.path, tool: r.tool, paint: r.firstPaintMs, total: r.totalMs, events: r.events.filter((e) => e.kind !== "op").map((e) => `${e.t} ${e.label}${e.detail ? ` (${e.detail.slice(0, 70)})` : ""}`) },
    text: document.querySelector(".pg-chat .a2-surface-host")?.textContent?.slice(0, 300),
  };
});
console.log(JSON.stringify({ before, after }, null, 2));
await p.screenshot({ path: "/tmp/a2ui-playground-shots/refine-in-place.png" });
await b.close();
