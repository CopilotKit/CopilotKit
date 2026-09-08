import { readFile, writeFile } from "node:fs/promises";

const manifestUrl = new URL("../dist/package.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

for (const entry of Object.values(manifest.exports ?? {})) {
  if (
    entry &&
    typeof entry === "object" &&
    "types" in entry &&
    "default" in entry
  ) {
    delete entry.import;
  }
}

await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
