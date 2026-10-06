// Publish-age audit for a regenerated package-lock.json.
// Usage: node lgts-lock-age-audit.mjs <label> <old-lock> <new-lock> <bound-iso>
// For every name@version in the new lock that the old lock lacks, reads the
// registry publish time (npm view <name> time --json) and flags any version
// published after the bound or less than 24 h before now. Also flags entries
// that do not resolve from registry.npmjs.org (exotic sources).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [label, oldPath, newPath, bound] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, "utf8")).packages ?? {};
const nameOf = (key, v) =>
  v.name ?? key.slice(key.lastIndexOf("node_modules/") + 13);
const pairs = (pkgs) => {
  const out = new Map();
  for (const [key, v] of Object.entries(pkgs)) {
    if (!key || v.link || !v.version) continue;
    out.set(`${nameOf(key, v)}@${v.version}`, v);
  }
  return out;
};
const oldPairs = pairs(read(oldPath));
const newPairs = pairs(read(newPath));
const added = [...newPairs.keys()].filter((k) => !oldPairs.has(k)).sort();
const removed = [...oldPairs.keys()].filter((k) => !newPairs.has(k)).sort();
const now = Date.now();
const boundMs = Date.parse(bound);
const times = new Map();
const rows = [];
const violations = [];
const exotic = [];
for (const pair of added) {
  const at = pair.lastIndexOf("@");
  const name = pair.slice(0, at);
  const version = pair.slice(at + 1);
  if (!times.has(name)) {
    times.set(
      name,
      JSON.parse(
        execFileSync("npm", ["view", name, "time", "--json"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      ),
    );
  }
  const published = times.get(name)[version];
  const ageH = published ? (now - Date.parse(published)) / 36e5 : NaN;
  rows.push({ pair, published, ageH: Number(ageH.toFixed(1)) });
  if (!published || Date.parse(published) > boundMs || ageH < 24) {
    violations.push(`${pair} published ${published} (${ageH.toFixed(1)} h)`);
  }
  const resolved = newPairs.get(pair).resolved ?? "";
  if (!resolved.startsWith("https://registry.npmjs.org/")) {
    exotic.push(`${pair} ${resolved || "(no resolved)"}`);
  }
}
rows.sort((a, b) => a.ageH - b.ageH);
console.log(
  JSON.stringify(
    {
      label,
      checkedAt: new Date(now).toISOString(),
      bound,
      floor24h: new Date(now - 864e5).toISOString(),
      addedOrChanged: added.length,
      removed: removed.length,
      violations,
      exoticResolved: exotic,
      youngest: rows.slice(0, 10).map((r) => `${r.pair} (${r.ageH} h)`),
      added: rows.map((r) => `${r.pair} ${r.published}`),
    },
    null,
    2,
  ),
);
