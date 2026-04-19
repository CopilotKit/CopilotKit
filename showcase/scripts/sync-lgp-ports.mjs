// Regenerate langgraph-python cell port entries in shared/local-ports.json.
// The entrypoint assigns ports by alphabetical sort of demos/*, so port
// assignment must match. Running this after adding/removing cells keeps
// the shell's preview iframes pointed at the right cells.
import fs from "fs";
import path from "path";

const ROOT = "/Users/ataibarkai/LocalGit/CopilotKit/showcase";
const DEMOS = path.join(ROOT, "packages/langgraph-python/demos");
const PORTS = path.join(ROOT, "shared/local-ports.json");

const cells = fs
  .readdirSync(DEMOS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const existing = JSON.parse(fs.readFileSync(PORTS, "utf-8"));

// Strip all langgraph-python cell entries (keep the column-level 3100)
for (const k of Object.keys(existing)) {
  if (k.startsWith("langgraph-python::")) delete existing[k];
}

// Rebuild with the current alphabetical ordering.
cells.forEach((cell, i) => {
  existing[`langgraph-python::${cell}`] = 3200 + i;
});

// Stable key order: put langgraph-python cell entries first, then the rest.
const ordered = {};
for (const cell of cells) {
  const key = `langgraph-python::${cell}`;
  ordered[key] = existing[key];
}
for (const k of Object.keys(existing)) {
  if (!k.startsWith("langgraph-python::")) ordered[k] = existing[k];
}

fs.writeFileSync(PORTS, JSON.stringify(ordered, null, 2) + "\n");
console.log(`Wrote ${cells.length} langgraph-python cell ports:`);
cells.forEach((cell, i) => console.log(`  ${3200 + i}  ${cell}`));
