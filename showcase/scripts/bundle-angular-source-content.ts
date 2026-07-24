import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAngularSourceContent } from "./lib/angular-source-content.js";

const showcaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const content = `${JSON.stringify(buildAngularSourceContent(showcaseRoot))}\n`;
for (const relativeOutput of [
  "shell/src/data/angular-source-content.json",
  "shell-docs/src/data/angular-source-content.json",
]) {
  const output = resolve(showcaseRoot, relativeOutput);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, content);
}
