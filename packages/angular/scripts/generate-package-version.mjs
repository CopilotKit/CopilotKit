import { readFileSync, writeFileSync } from "node:fs";

// ng-packagr relocates compiled modules before bundling, so a relative JSON import
// cannot reach the source manifest. Generate the version beside the TypeScript source.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const target = new URL("../src/lib/package-version.ts", import.meta.url);
const source = `// Generated from package.json. Do not edit.\nexport const ANGULAR_SDK_VERSION = ${JSON.stringify(version)};\n`;
let current;
try {
  current = readFileSync(target, "utf8");
} catch {
  /* First build. */
}
if (current !== source) writeFileSync(target, source);
