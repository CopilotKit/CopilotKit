/**
 * Runs a prompt suite through the real chat in headless Chrome, one fresh page
 * per prompt. Saves a full-page screenshot and a canvas-only screenshot per run
 * and writes timings to docs/timings.json.
 *
 *   node scripts/batch.mjs [suite=all|fixed|dynamic] [filter]
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const SUITE = [
  { slug: "fixed-weather", mode: "fixed", prompt: "What's the weather in Lisbon this week?" },
  { slug: "fixed-places", mode: "fixed", prompt: "Find coffee shops near Alfama, Lisbon" },
  { slug: "fixed-route", mode: "fixed", prompt: "Drive from Porto to Lisbon" },
  { slug: "fixed-fx", mode: "fixed", prompt: "USD to EUR, GBP and JPY" },
  { slug: "fixed-flights", mode: "fixed", prompt: "Flights from SFO to JFK on Friday" },
  { slug: "fixed-signup", mode: "fixed", prompt: "A signup form for my newsletter app" },
  { slug: "fixed-stock", mode: "fixed", prompt: "NVDA stock dashboard" },
  { slug: "fixed-receipt", mode: "fixed", prompt: "Show my receipt from Blue Bottle: 2 lattes at $5.50, a croissant $4.25, tax $1.20" },
  { slug: "dynamic-weather", mode: "dynamic", prompt: "What's the weather in Lisbon this week?" },
  { slug: "dynamic-tokyo", mode: "dynamic", prompt: "Plan a 3-day Tokyo trip with a map and a day-by-day timeline" },
  { slug: "dynamic-paris", mode: "dynamic", prompt: "2 days in Paris with a map" },
  { slug: "dynamic-stocks", mode: "dynamic", prompt: "Compare AAPL and MSFT this quarter" },
  { slug: "dynamic-pricing", mode: "dynamic", prompt: "Pricing comparison for three SaaS tiers with a recommendation" },
  { slug: "dynamic-sales", mode: "dynamic", prompt: "Q3 sales by region as a dashboard" },
  { slug: "dynamic-onboarding", mode: "dynamic", prompt: "An onboarding checklist form for a new engineer with team, start date and laptop choice" },
  { slug: "auto-ramen", mode: "auto", prompt: "Ramen spots in Osaka" },
  { slug: "auto-budget", mode: "auto", prompt: "Where does a $5k monthly budget go? Show it as a flow" },
  // Coverage prompts: each should pull components the suite above never uses.
  { slug: "fixed-recipe", mode: "fixed", prompt: "A weeknight shakshuka recipe for two" },
  { slug: "dynamic-agenda", mode: "dynamic", prompt: "Agenda for a two-day React conference in Berlin: the venue, sessions by time and room, and who is attending" },
  { slug: "dynamic-team", mode: "dynamic", prompt: "Team page for our 4-person platform team: a profile for each person, their skills, who is on call, and sprint progress" },
  { slug: "dynamic-laptops", mode: "dynamic", prompt: "Compare three 14-inch developer laptops with price, rating, specs and a score per criterion" },
  { slug: "dynamic-review", mode: "dynamic", prompt: "Code review summary for PR #482 (retry logic in the payments client): the risky code snippet, review timeline, reviewers and test coverage" },
  { slug: "dynamic-booking", mode: "dynamic", prompt: "Booking form for a lakeside cabin: check-in date, number of guests, cabin type, extras like breakfast or kayak, and special requests" },
];

const [, , suite = "all", filter] = process.argv;
const runs = SUITE.filter((s) => (suite === "all" || s.mode === suite || s.slug === suite) && (!filter || s.slug.includes(filter)));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
const OUT = process.env.OUT ?? "docs/timings.json";
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
for (const r of runs) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto("http://localhost:3100/playground", { waitUntil: "networkidle2", timeout: 120000 });
  await page.evaluate((m) => window.__setMode?.(m), r.mode);
  await new Promise((res) => setTimeout(res, 500));
  const ta = await page.waitForSelector("textarea");
  await ta.click();
  await ta.type(r.prompt);
  await page.keyboard.press("Enter");
  try {
    await page.waitForFunction(() => window.__runStore?.current()?.status && window.__runStore.current().status !== "running", { timeout: 90000, polling: 100 });
  } catch {
    errors.push("timeout");
  }
  await new Promise((res) => setTimeout(res, 2500));
  const run = await page.evaluate(() => {
    const x = window.__runStore.current();
    const failures = Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.textContent?.slice(0, 160));
    return { path: x.path, tool: x.tool, firstFrameMs: x.firstFrameMs, firstPaintMs: x.firstPaintMs, totalMs: x.totalMs, status: x.status, failures, components: Object.values(window.__runStore.get().surfaces).at(-1)?.componentCount ?? 0, types: (() => { const k = x.surfaceKey; const ops = k ? window.__runStore.get().surfaces[k]?.ops ?? [] : []; let comps = []; for (const o of ops) if (o.updateComponents) comps = o.updateComponents.components; return [...new Set(comps.map((c) => c.component).filter((c) => c !== "Blueprint"))]; })(), events: x.events.filter((e) => e.kind !== "op").map((e) => `${e.t} ${e.label}${e.detail ? ` (${e.detail.slice(0, 80)})` : ""}`) };
  });
  await page.screenshot({ path: `/tmp/a2ui-playground-shots/run-${r.slug}.png` });
  // Render the final ops at full height on /snapshot (a scrolled chat cannot be element-captured cleanly).
  const ops = await page.evaluate(() => { const s = window.__runStore.get(); const k = s.runs.at(-1)?.surfaceKey; return k ? s.surfaces[k]?.ops : null; });
  if (ops) {
    const snap = await browser.newPage();
    await snap.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
    await snap.goto("http://localhost:3100/snapshot", { waitUntil: "domcontentloaded" });
    await snap.evaluate((o) => localStorage.setItem("a2ui-snapshot", JSON.stringify(o)), ops);
    await snap.reload({ waitUntil: "networkidle2" });
    await new Promise((res) => setTimeout(res, 2500));
    await snap.screenshot({ path: `/tmp/a2ui-playground-shots/canvas-${r.slug}.png`, fullPage: true });
    await snap.close();
  }
  out[r.slug] = { ...r, ...run, errors, at: new Date().toISOString() };
  console.log(`${r.slug.padEnd(20)} ${String(run.path).padEnd(8)} ${String(run.tool).padEnd(18)} frame ${run.firstFrameMs}ms paint ${run.firstPaintMs}ms total ${run.totalMs}ms comps ${run.components} fail ${run.failures.length} err ${errors.length}`);
  if (run.failures.length) console.log("   failures:", run.failures.join(" | "));
  await page.close();
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
await browser.close();
