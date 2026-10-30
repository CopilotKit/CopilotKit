/**
 * Finds words that break across lines (mid-token wraps) and horizontal
 * overflow inside every catalog preview (/components/<name>), at several viewport widths.
 *   node scripts/check-wrap.mjs [widths=1440,900,640] [filter=Stat,StatGroup,Grid]
 */
import puppeteer from "puppeteer-core";
import { componentNames, openComponent } from "./lib-components.mjs";
const [, , widthsArg = "1440,900,640", filter] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle"] });
let total = 0;
for (const w of widthsArg.split(",").map(Number)) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: 1200 });
  const names = await componentNames(p, filter?.split(","));
  const issues = [];
  for (const n of names) {
  await openComponent(p, n, 1500);
  issues.push(...(await p.evaluate(() => {
    const out = [];
    for (const sec of document.querySelectorAll("[data-preview]")) {
      const name = sec.dataset.preview;
      const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent;
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
          if (m[0].length < 2) continue;
          const r = document.createRange();
          r.setStart(node, m.index);
          r.setEnd(node, m.index + m[0].length);
          const rects = [...r.getClientRects()].filter((x) => x.width > 0);
          if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 4) out.push(`${name}: wraps "${m[0]}"`);
        }
      }
      for (const el of sec.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !el.closest("svg,canvas,.maplibregl-map")) {
          if ((el.textContent || "").trim() && (cs.whiteSpace === "nowrap" || el.children.length === 0)) out.push(`${name}: overflow <${el.tagName.toLowerCase()}> "${(el.textContent || "").slice(0, 30)}"`);
        }
      }
    }
    return [...new Set(out)];
  })));
  }
  total += issues.length;
  console.log(`width ${w}: ${issues.length} issue(s)`);
  for (const i of issues.slice(0, 40)) console.log("  " + i);
  await p.close();
}
await b.close();
process.exitCode = total ? 1 : 0;
