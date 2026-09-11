/**
 * Materialize frontend sources that must remain byte-identical across showcase
 * integrations. Next resolves dependencies from each integration package, so
 * these files are copied into their package instead of imported through a
 * cross-package runtime symlink. The source below is the only editable copy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const showcaseRoot = path.resolve(scriptsDir, "..");

const sharedStateReadSource = path.join(
  showcaseRoot,
  "shared/react/demos/shared-state-read/page.tsx",
);
const sharedStateReadTargets = [
  "strands",
  "langgraph-python",
  "langgraph-typescript",
].map((slug) =>
  path.join(
    showcaseRoot,
    "integrations",
    slug,
    "src/app/demos/shared-state-read/page.tsx",
  ),
);

export function syncSharedFrontends(write = false): string[] {
  const source = fs.readFileSync(sharedStateReadSource, "utf8");
  const drift: string[] = [];

  for (const target of sharedStateReadTargets) {
    const current = fs.readFileSync(target, "utf8");
    if (current === source) continue;
    drift.push(path.relative(showcaseRoot, target));
    if (write) fs.writeFileSync(target, source);
  }

  return drift;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const write = process.argv.includes("--write");
  const drift = syncSharedFrontends(write);
  if (drift.length === 0) {
    console.log("Shared frontend sources are in sync.");
  } else if (write) {
    console.log(
      `Updated ${drift.length} shared frontend target(s):\n${drift.join("\n")}`,
    );
  } else {
    console.error(
      `Shared frontend drift detected. Edit ${path.relative(showcaseRoot, sharedStateReadSource)} then run ` +
        `\`pnpm --dir showcase/scripts sync-shared-frontends -- --write\`:\n${drift.join("\n")}`,
    );
    process.exitCode = 1;
  }
}
