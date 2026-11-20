import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildVueSourceContent } from "./lib/vue-source-content.js";

const showcaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The Showcase shell's Vue source viewer is the sole consumer. Shell-docs
// intentionally does not generate or copy this bundle.
const output = resolve(showcaseRoot, "shell/src/data/vue-source-content.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(buildVueSourceContent(showcaseRoot))}\n`,
);
