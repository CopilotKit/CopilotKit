import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const distDir = new URL("../dist", import.meta.url).pathname;

// Map of workspace-relative path patterns → npm package names
// These appear in generated .d.ts files from vite-plugin-dts
const replacements = [
  [
    /(['"])(?:\.\.\/)+@copilotkit\/([^/'"]+)\1/g,
    (match, quote, pkg) => `${quote}@copilotkit/${pkg}${quote}`,
  ],
  [
    /(['"])(?:\.\.\/)+core\/dist\/index\.d\.[mc]?ts\1/g,
    (match, quote) => `${quote}@copilotkit/core${quote}`,
  ],
  [
    /(['"])(?:\.\.\/)+shared\/dist\/index\.d\.[mc]?ts\1/g,
    (match, quote) => `${quote}@copilotkit/shared${quote}`,
  ],
  [
    /(['"])(?:\.\.\/)+web-inspector\/dist\/index\.d\.[mc]?ts\1/g,
    (match, quote) => `${quote}@copilotkit/web-inspector${quote}`,
  ],
  [
    /(['"])(?:\.\.\/)+web-components\/dist\/index\.d\.[mc]?ts\1/g,
    (match, quote) => `${quote}@copilotkit/web-components${quote}`,
  ],
];

function fixFile(filePath) {
  let content = readFileSync(filePath, "utf8");
  const original = content;
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  if (content !== original) {
    writeFileSync(filePath, content, "utf8");
    console.log(`Fixed: ${filePath}`);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (entry.endsWith(".d.ts") || entry.endsWith(".d.mts")) {
      fixFile(full);
    }
  }
}

walk(distDir);
