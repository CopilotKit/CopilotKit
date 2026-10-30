/**
 * Component coverage across batch runs: which catalog components the agent really used.
 *   node scripts/coverage.mjs docs/coverage-before.json [more.json ...] [--md]
 */
import fs from "node:fs";
const args = process.argv.slice(2);
const md = args.includes("--md");
const files = args.filter((a) => !a.startsWith("--"));
const defsSrc = ["layout", "content", "data", "charts", "maps", "inputs", "feedback", "domain"]
  .map((f) => fs.readFileSync(`src/a2ui/catalog/definitions/${f}.ts`, "utf8"))
  .join("\n");
const names = [...defsSrc.matchAll(/^\s{2}([A-Z][A-Za-z]+): def\(/gm)].map((m) => m[1]);
const runs = files.flatMap((f) => Object.values(JSON.parse(fs.readFileSync(f, "utf8"))));
const count = Object.fromEntries(names.map((n) => [n, 0]));
for (const r of runs) for (const t of new Set(r.types ?? [])) if (t in count) count[t]++;
const used = names.filter((n) => count[n] > 0);
const unused = names.filter((n) => count[n] === 0);
if (md) {
  console.log(`| Component | Runs that used it (of ${runs.length}) |\n| --- | --- |`);
  for (const n of names.slice().sort((a, b) => count[b] - count[a] || a.localeCompare(b))) console.log(`| \`${n}\` | ${count[n]} |`);
} else {
  console.log(`runs: ${runs.length}, components used: ${used.length}/${names.length}`);
  console.log(`never used (${unused.length}): ${unused.join(", ")}`);
  console.log(`top: ${names.slice().sort((a, b) => count[b] - count[a]).slice(0, 12).map((n) => `${n} ${count[n]}`).join(", ")}`);
}
