/** Verifies every catalog component renders its sample on its /components/<name> page without validation errors. */
import puppeteer from "puppeteer-core";
import { componentNames, openComponent } from "./lib-components.mjs";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-gl=angle", "--enable-webgl"], defaultViewport: { width: 1440, height: 1200 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const names = await componentNames(p);
const res = { total: names.length, pending: [], noSample: [], failed: [], empty: [] };
for (const n of names) {
  await openComponent(p, n);
  const r = await p.$eval(`[data-preview="${n}"]`, (s) => ({
    pending: s.textContent.includes("renderer pending"),
    noSample: s.textContent.includes("no sample"),
    failed: !!s.querySelector('[role="alert"]'),
    empty: s.getBoundingClientRect().height < 40,
  }));
  for (const k of ["pending", "noSample", "failed", "empty"]) if (r[k]) res[k].push(n);
}
console.log(JSON.stringify({ ...res, pageErrors: errors }, null, 2));
await b.close();
