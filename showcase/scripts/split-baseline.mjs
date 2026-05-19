// showcase/scripts/split-baseline.mjs
import fs from "fs";
import path from "path";

const baseline = fs.readFileSync("verify-baseline.txt", "utf-8").split("\n");
const summary = JSON.parse(
  fs.readFileSync("audit-output/_summary.json", "utf-8"),
);
const outDir = "audit-output";

for (const slug of summary.unready) {
  const matching = baseline.filter(
    (line) => line.includes(`integrations/${slug}/`) || line.includes(`integrations\\${slug}\\`),
  );
  fs.writeFileSync(
    path.join(outDir, `${slug}.baseline.txt`),
    matching.length > 0
      ? matching.join("\n")
      : "# No pre-existing failures for this framework.",
  );
}

console.log(`Baseline files written for ${summary.unready.length} frameworks.`);
