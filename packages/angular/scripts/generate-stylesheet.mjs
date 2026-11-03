import { readFileSync, writeFileSync } from "node:fs";
import { stylesheet } from "@copilotkit/core/styles";

// Angular reads a component's `styles` at compile time, so they must be a
// literal in this package's source; an imported value from another package is
// not. Copy the CSS that @copilotkit/core ships beside the TypeScript source.
const target = new URL("../src/lib/components/stylesheet.ts", import.meta.url);
const source = `// Generated from @copilotkit/core/styles. Do not edit.\nexport const stylesheet = ${JSON.stringify(stylesheet)};\n`;
let current;
try {
  current = readFileSync(target, "utf8");
} catch {
  /* First build. */
}
if (current !== source) writeFileSync(target, source);
