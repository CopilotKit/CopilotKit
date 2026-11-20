// Builds a chart page from a `web` report.
//
//   node scripts/aeo-eval/charts.mjs <report.json> <out.html> [normal.json]
//
// With a third file, the page also compares that normal run with the first
// report, which is then expected to be the blind run.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [resultsFile, outFile, compareFile] = process.argv.slice(2);
if (!resultsFile || !outFile) {
  console.error(
    "Usage: node scripts/aeo-eval/charts.mjs <report.json> <out.html> [normal.json]",
  );
  process.exit(1);
}
const baseline = compareFile
  ? JSON.parse(readFileSync(compareFile, "utf8"))
  : null;
const report = JSON.parse(readFileSync(resultsFile, "utf8"));
const suite = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));
const results = report.results;
const promptList = [
  ...suite.prompts.filter((p) => suite.unbrandedFitPrompts.includes(p.id)),
  ...suite.webPrompts,
];
const promptText = Object.fromEntries(promptList.map((p) => [p.id, p.prompt]));

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const isCK = (s) => /copilot\s*-?\s*kit/i.test(s ?? "");
const productKey = (name) => {
  if (isCK(name)) return "copilotkit";
  const k = name
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .toLowerCase();
  if (/^ag-?ui( protocol)?$/.test(k)) return "ag-ui";
  return k;
};

// ---- numbers ---------------------------------------------------------------
const total = results.length;
const recommended = results.filter((r) => r.copilotkitRank).length;
const first = results.filter((r) => r.copilotkitRank === 1).length;
const readDocs = results.filter((r) => r.readCopilotKitDocs).length;
const notMentioned = results.filter((r) => !r.mentioned).length;

const byPrompt = promptList
  .map((p) => {
    const rs = results.filter((r) => r.id === p.id);
    const f = rs.filter((r) => r.copilotkitRank === 1).length;
    const rec = rs.filter((r) => r.copilotkitRank).length;
    const ranks = rs
      .filter((r) => r.copilotkitRank)
      .map((r) => r.copilotkitRank);
    // Most common first pick when CopilotKit was not first.
    const others = new Map();
    for (const r of rs) {
      const top = r.answer.recommended_products[0];
      if (top && !isCK(top)) {
        const k = top.replace(/\s*\(.*\)\s*$/, "").trim();
        others.set(k, (others.get(k) ?? 0) + 1);
      }
    }
    const topOther = [...others.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      id: p.id,
      title: p.title,
      runs: rs.length,
      first: f,
      lower: rec - f,
      none: rs.length - rec,
      recommended: rec,
      ranks,
      readDocs: rs.filter((r) => r.readCopilotKitDocs).length,
      topOther: topOther ? `${topOther[0]} (${topOther[1]})` : "",
    };
  })
  .filter((p) => p.runs > 0);

function countTop(items, limit) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

// Display names: keep the most common original spelling for each key.
const spelling = new Map();
for (const r of results)
  for (const name of r.answer.recommended_products) {
    const key = productKey(name);
    const clean = name.replace(/\s*\(.*\)\s*$/, "").trim();
    const m = spelling.get(key) ?? new Map();
    m.set(clean, (m.get(clean) ?? 0) + 1);
    spelling.set(key, m);
  }
const FIXED = { copilotkit: "CopilotKit", "ag-ui": "AG-UI" };
const displayName = (key) =>
  FIXED[key] ??
  [...(spelling.get(key) ?? new Map([[key, 1]])).entries()].sort(
    (a, b) => b[1] - a[1],
  )[0][0];

const products = countTop(
  results.flatMap((r) => [
    ...new Set(r.answer.recommended_products.map(productKey)),
  ]),
  12,
).map(([k, n]) => [displayName(k), n]);
const hosts = countTop(
  results.flatMap((r) => [...new Set(r.citations.map((c) => c.host))]),
  10,
);

// Model prior: did the agent's searches name CopilotKit before it read anything?
const firstSearchNamesCK = results.filter((r) => isCK(r.searches?.[0]));
const firstSearchNeutral = results.filter(
  (r) => r.searches?.length && !isCK(r.searches[0]),
);
const prior = [
  {
    label: "First search named CopilotKit",
    runs: firstSearchNamesCK.length,
    rec: firstSearchNamesCK.filter((r) => r.copilotkitRank).length,
  },
  {
    label: "First search did not",
    runs: firstSearchNeutral.length,
    rec: firstSearchNeutral.filter((r) => r.copilotkitRank).length,
  },
];

// ---- svg helpers -----------------------------------------------------------
const W = 680; // drawing width; the svg scales down with the frame

function hbar({ rows, labelW = 190, valueW = 56, max, colorFor, tip, unit }) {
  const band = 32;
  const barH = 20;
  const plotW = W - labelW - valueW;
  const top = 8;
  const h = top + rows.length * band + 26;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max));
  const x = (v) => labelW + (v / max) * plotW;
  let s = `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img">`;
  for (const t of [...new Set(ticks)]) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${h - 22}" class="grid"/>`;
    s += `<text x="${x(t)}" y="${h - 6}" class="tick" text-anchor="middle">${t}${unit ?? ""}</text>`;
  }
  s += `<line x1="${labelW}" x2="${labelW}" y1="${top}" y2="${h - 22}" class="axis"/>`;
  rows.forEach((r, i) => {
    const y = top + i * band + (band - barH) / 2;
    const w = Math.max((r.value / max) * plotW, r.value ? 2 : 0);
    s += `<text x="${labelW - 10}" y="${y + barH / 2}" class="label" text-anchor="end" dominant-baseline="central">${esc(r.label)}</text>`;
    if (w > 0) {
      const rr = Math.min(4, w);
      s += `<path d="M${labelW},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${barH - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${w - rr} z" fill="${colorFor(r)}"/>`;
    }
    s += `<text x="${labelW + w + 8}" y="${y + barH / 2}" class="value" dominant-baseline="central">${esc(r.valueLabel ?? r.value)}</text>`;
    s += `<rect x="0" y="${top + i * band}" width="${W}" height="${band}" fill="transparent" class="hit" data-tip="${esc(tip(r))}"/>`;
  });
  return s + "</svg>";
}

// One 100% bar per prompt: ranked first / lower rank / not recommended.
function stacked(rows) {
  const labelW = 210;
  const valueW = 70;
  const band = 34;
  const barH = 20;
  const plotW = W - labelW - valueW;
  const top = 8;
  const h = top + rows.length * band + 26;
  const x = (f) => labelW + f * plotW;
  let s = `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img">`;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line x1="${x(f)}" x2="${x(f)}" y1="${top}" y2="${h - 22}" class="grid"/>`;
    s += `<text x="${x(f)}" y="${h - 6}" class="tick" text-anchor="middle">${f * 100}%</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * band + (band - barH) / 2;
    s += `<text x="${labelW - 10}" y="${y + barH / 2}" class="label" text-anchor="end" dominant-baseline="central">${esc(`${r.id} ${r.title}`)}</text>`;
    const parts = [
      ["first", r.first, "Ranked first"],
      ["lower", r.lower, "Recommended, lower rank"],
      ["none", r.none, "Not recommended"],
    ].filter((p) => p[1] > 0);
    let cx = 0;
    parts.forEach(([cls, n, name], j) => {
      const gap = j > 0 ? 2 : 0;
      const w = (n / r.runs) * plotW - gap;
      const x0 = labelW + cx + gap;
      // Only the outer end of the bar is rounded.
      const rr = j === parts.length - 1 ? Math.min(4, w) : 0;
      s += `<path d="M${x0},${y} h${w - rr} ${rr ? `a${rr},${rr} 0 0 1 ${rr},${rr} v${barH - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr}` : `v${barH}`} h-${w - rr} z" class="seg-${cls}" data-tip="${esc(`${r.id} ${r.title}: ${name}, ${n} of ${r.runs} answers`)}"/>`;
      cx += w + gap;
    });
    s += `<text x="${W - valueW + 10}" y="${y + barH / 2}" class="value" dominant-baseline="central">${r.recommended}/${r.runs}</text>`;
    s += `<rect x="0" y="${top + i * band}" width="${labelW}" height="${band}" fill="transparent" class="hit" data-tip="${esc(`${r.id}: ${promptText[r.id]}`)}"/>`;
  });
  return s + "</svg>";
}

// Recommended rate per prompt: the normal run (gray) and this run (accent).
function dumbbell(rows, what) {
  const labelW = 210;
  const band = 30;
  const plotW = W - labelW - 70;
  const top = 8;
  const h = top + rows.length * band + 26;
  const x = (v) => labelW + (v / 100) * plotW;
  let s = `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img">`;
  for (const f of [0, 25, 50, 75, 100]) {
    s += `<line x1="${x(f)}" x2="${x(f)}" y1="${top}" y2="${h - 22}" class="grid"/>`;
    s += `<text x="${x(f)}" y="${h - 6}" class="tick" text-anchor="middle">${f}%</text>`;
  }
  rows.forEach((r, i) => {
    const cy = top + i * band + band / 2;
    s += `<text x="${labelW - 10}" y="${cy}" class="label" text-anchor="end" dominant-baseline="central">${esc(`${r.id} ${r.title}`)}</text>`;
    s += `<line x1="${x(r.before)}" x2="${x(r.after)}" y1="${cy}" y2="${cy}" class="connector"/>`;
    // The normal dot is larger, so it stays visible as a ring when equal.
    s += `<circle cx="${x(r.before)}" cy="${cy}" r="7" class="dot-before"/>`;
    s += `<circle cx="${x(r.after)}" cy="${cy}" r="5" class="dot-after"/>`;
    const d = r.after - r.before;
    s += `<text x="${W - 60}" y="${cy}" class="value" dominant-baseline="central">${d > 0 ? "+" : ""}${d} pts</text>`;
    s += `<rect x="0" y="${top + i * band}" width="${W}" height="${band}" fill="transparent" class="hit" data-tip="${esc(`${r.id} ${r.title}: ${what} ${r.before}% normal, ${r.after}% blind`)}"/>`;
  });
  return s + "</svg>";
}

const compareSection = (() => {
  if (!baseline) return "";
  const rowsFor = (test) =>
    byPrompt.map((p) => {
      const rs = baseline.results.filter((r) => r.id === p.id);
      const mine = results.filter((r) => r.id === p.id);
      return {
        id: p.id,
        title: p.title,
        before: pct(rs.filter(test).length, rs.length),
        after: pct(mine.filter(test).length, mine.length),
      };
    });
  const legend = `<div class="legend"><span><i class="sw" style="background:var(--quiet-mark);border-radius:50%"></i>Normal run</span><span><i class="sw" style="background:var(--accent-mark);border-radius:50%"></i>Blind run</span></div>`;
  return `<section>
    <h2>Recommended at all: normal vs blind</h2>
    <p class="sub">Share of answers per prompt that recommend CopilotKit. Blind runs may name a product only after the web showed it.</p>
    ${legend}
    ${dumbbell(
      rowsFor((r) => r.copilotkitRank),
      "recommended",
    )}
  </section>
  <section>
    <h2>Ranked first: normal vs blind</h2>
    <p class="sub">Share of answers per prompt that put CopilotKit first.</p>
    ${legend}
    ${dumbbell(
      rowsFor((r) => r.copilotkitRank === 1),
      "ranked first",
    )}
  </section>`;
})();

const fromWeb = results.filter(
  (r) => r.copilotkitRank && r.discovery === "web",
).length;
const fromMemory = results.filter((r) => r.discovery === "memory").length;
const baseRec = baseline
  ? baseline.results.filter((r) => r.copilotkitRank).length
  : 0;
const baseFirst = baseline
  ? baseline.results.filter((r) => r.copilotkitRank === 1).length
  : 0;

// ---- page ------------------------------------------------------------------
const tile = (label, value, sub) =>
  `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;

const productChart = hbar({
  rows: products.map(([label, n]) => ({
    label,
    n,
    value: pct(n, total),
    valueLabel: `${pct(n, total)}%`,
  })),
  max: 100,
  unit: "%",
  colorFor: (r) => (isCK(r.label) ? "var(--accent-mark)" : "var(--quiet-mark)"),
  tip: (r) => `${r.label}: recommended in ${r.n} of ${total} answers`,
});
const hostChart = hbar({
  rows: hosts.map(([label, value]) => ({ label, value })),
  max: Math.max(...hosts.map((h) => h[1]), 1),
  colorFor: (r) =>
    r.label.includes("copilotkit") ? "var(--accent-mark)" : "var(--quiet-mark)",
  tip: (r) => `${r.label}: cited in ${r.value} answers`,
});
const priorChart = hbar({
  rows: prior.map((p) => ({
    label: `${p.label} (${p.runs})`,
    value: pct(p.rec, p.runs),
    valueLabel: `${pct(p.rec, p.runs)}%`,
    p,
  })),
  labelW: 250,
  max: 100,
  unit: "%",
  colorFor: (r) =>
    r.p.label.startsWith("First search named")
      ? "var(--accent-mark)"
      : "var(--quiet-mark)",
  tip: (r) =>
    `${r.p.label}: CopilotKit recommended in ${r.p.rec} of ${r.p.runs} answers`,
});

const tableRows = byPrompt
  .map(
    (r) =>
      `<tr><td><span class="pid">${r.id}</span> ${esc(r.title)}</td><td class="num">${r.recommended}/${r.runs}</td><td class="num">${r.first}/${r.runs}</td><td class="num">${r.ranks.length ? (r.ranks.reduce((a, b) => a + b, 0) / r.ranks.length).toFixed(1) : "-"}</td><td class="num">${r.readDocs}/${r.runs}</td><td>${esc(r.topOther || "-")}</td></tr>`,
  )
  .join("");

const date = report.date.slice(0, 10);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AEO Web Report</title>
<style>
:root {
  --accent-mark: var(--chart-1, #2a78d6);
  --quiet-mark: color-mix(in oklab, var(--foreground, #0b0b0b) 28%, transparent);
  --ink: var(--foreground, #0b0b0b);
  --ink-2: var(--muted-foreground, #52514e);
  --hair: var(--border, #e1e0d9);
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 760px; padding: 24px 16px; background: var(--background, #fff); font-family: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif); color: var(--ink); }
.wrap { display: grid; gap: 28px; }
h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.sub { font-size: 13px; color: var(--ink-2); margin: 0 0 12px; line-height: 1.45; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.tile { border: 1px solid var(--hair); border-radius: var(--radius, 8px); padding: 14px 16px; }
.tile-label { font-size: 12px; color: var(--ink-2); }
.tile-value { font-size: 30px; font-weight: 600; margin: 4px 0 2px; }
.tile-sub { font-size: 12px; color: var(--ink-2); }
svg { display: block; overflow: visible; }
.grid { stroke: var(--hair); stroke-width: 1; }
.axis { stroke: color-mix(in oklab, var(--ink) 30%, transparent); stroke-width: 1; }
.tick { font-size: 11px; fill: var(--ink-2); font-variant-numeric: tabular-nums; }
.label { font-size: 12.5px; fill: var(--ink); }
.value { font-size: 12px; fill: var(--ink-2); font-variant-numeric: tabular-nums; }
.seg-first { fill: var(--accent-mark); }
.connector { stroke: var(--hair); stroke-width: 2; }
.dot-before { fill: var(--quiet-mark); stroke: var(--background, #fff); stroke-width: 2; }
.dot-after { fill: var(--accent-mark); stroke: var(--background, #fff); stroke-width: 2; }
.seg-lower { fill: color-mix(in oklab, var(--accent-mark) 55%, transparent); }
.seg-none { fill: color-mix(in oklab, var(--ink) 12%, transparent); }
.legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--ink-2); margin: 0 0 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--hair); vertical-align: top; }
th { font-weight: 600; color: var(--ink-2); font-size: 12px; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pid { color: var(--ink-2); font-variant-numeric: tabular-nums; }
details summary { cursor: pointer; font-size: 13px; color: var(--ink-2); }
#tip { position: fixed; pointer-events: none; padding: 6px 9px; font-size: 12px; line-height: 1.4; max-width: 320px;
  background: var(--popover, #fff); color: var(--popover-foreground, var(--ink)); border: 1px solid var(--hair);
  border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.12); opacity: 0; transition: opacity .08s; z-index: 10; }
[data-tip] { cursor: default; }
[data-tip]:hover { opacity: .85; }
.hit:hover { opacity: 1; fill: color-mix(in oklab, var(--ink) 4%, transparent); }
.note { font-size: 12px; color: var(--ink-2); line-height: 1.5; }
</style></head><body>
<div class="wrap">
  <section>
    <div class="kpis">
      ${(baseline
        ? [
            tile(
              "Recommended, normal",
              `${pct(baseRec, baseline.results.length)}%`,
              `${baseRec} of ${baseline.results.length} answers`,
            ),
            tile(
              "Recommended, blind",
              `${pct(recommended, total)}%`,
              `${recommended} of ${total} answers`,
            ),
            tile(
              "Ranked first, normal",
              `${pct(baseFirst, baseline.results.length)}%`,
              `${baseFirst} of ${baseline.results.length} answers`,
            ),
            tile(
              "Ranked first, blind",
              `${pct(first, total)}%`,
              `${first} of ${total} answers`,
            ),
          ]
        : [
            tile(
              "Recommended CopilotKit",
              `${pct(recommended, total)}%`,
              `${recommended} of ${total} answers`,
            ),
            tile(
              "Ranked it first",
              `${pct(first, total)}%`,
              `${first} of ${total} answers`,
            ),
            tile(
              "Read CopilotKit docs",
              `${pct(readDocs, total)}%`,
              `${readDocs} of ${total} answers`,
            ),
            tile(
              "Never mentioned it",
              `${pct(notMentioned, total)}%`,
              `${notMentioned} of ${total} answers`,
            ),
          ]
      ).join("")}
    </div>
    <p class="note" style="margin-top:10px">Production web search, ${report.docsBaseUrl ? "docs pages from a branch build" : "production docs"}. ${esc(report.model)} agent, ${report.runs} run${report.runs === 1 ? "" : "s"} per prompt, ${date}. Prompts never name CopilotKit.${report.blind ? ` Blind: in ${fromWeb} of ${recommended} recommendations, a search result or page showed CopilotKit before the agent named it. ${fromMemory} runs named it from memory.` : ""} Cost $${report.summary.costUsd}.</p>
  </section>

  ${compareSection}

  <section>
    <h2>How each prompt went${baseline ? " (blind)" : ""}</h2>
    <p class="sub">Share of answers per prompt. The number on the right is answers that recommended CopilotKit.</p>
    <div class="legend"><span><i class="sw seg-first" style="background:var(--accent-mark)"></i>Ranked first</span><span><i class="sw" style="background:color-mix(in oklab, var(--accent-mark) 55%, transparent)"></i>Recommended, lower rank</span><span><i class="sw" style="background:color-mix(in oklab, var(--ink) 12%, transparent)"></i>Not recommended</span></div>
    ${stacked(byPrompt)}
  </section>

  <section>
    <h2>What the agent recommended</h2>
    <p class="sub">Share of all ${total} answers that recommend each product. One answer can name several.</p>
    ${productChart}
  </section>

  <section>
    <h2>Where the answers came from</h2>
    <p class="sub">Answers that cite each site, top 10.</p>
    ${hostChart}
  </section>

  <section${report.blind ? " hidden" : ""}>
    <h2>The model already knew the name</h2>
    <p class="sub">CopilotKit recommendation rate, split by whether the agent's first search already named CopilotKit, before it read any page.</p>
    ${priorChart}
  </section>

  <section>
    <details><summary>Table view</summary>
    <table><thead><tr><th>Prompt</th><th class="num">Recommended</th><th class="num">First</th><th class="num">Mean rank</th><th class="num">Read docs</th><th>Top pick when not CopilotKit</th></tr></thead><tbody>${tableRows}</tbody></table>
    </details>
  </section>
</div>
<div id="tip" role="tooltip"></div>
<script>
const tip = document.getElementById("tip");
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest && e.target.closest("[data-tip]");
  if (!t) { tip.style.opacity = 0; return; }
  tip.textContent = t.getAttribute("data-tip");
  const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + "px"; tip.style.top = (e.clientY + 14) + "px"; tip.style.opacity = 1;
});
</script>
</body></html>`;
writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
