import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { stylesheet } from "@copilotkit/core/styles";

/** Writes a generated TypeScript module, only when its content changed. */
function writeGenerated(relativePath, source) {
  const target = new URL(relativePath, import.meta.url);
  let current;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    /* First build. */
  }
  if (current !== source) writeFileSync(target, source);
}

// Angular reads a component's `styles` at compile time, so they must be a
// literal in this package's source; an imported value from another package is
// not. Copy the CSS that @copilotkit/core ships beside the TypeScript source.
writeGenerated(
  "../src/lib/components/stylesheet.ts",
  `// Generated from @copilotkit/core/styles. Do not edit.\nexport const stylesheet = ${JSON.stringify(stylesheet)};\n`,
);

// KaTeX's stylesheet lists every font in woff2, woff and ttf. ng-packagr
// inlines each `url()` as base64, so importing it as-is put all 60 files
// (~1.4 MB) into the package. Every browser Angular supports reads woff2, so
// keep only the woff2 source of each font and embed that.
const require = createRequire(import.meta.url);
const katexCssPath = require.resolve("katex/dist/katex.min.css");
const katexFontsDir = join(dirname(katexCssPath), "fonts");
let fontFaces = 0;
const katexStylesheet = readFileSync(katexCssPath, "utf8").replace(
  /src:([^;}]+)/g,
  (_, sources) => {
    const woff2 = /url\((fonts\/[^)]+\.woff2)\)/.exec(sources);
    if (!woff2) {
      throw new Error(`KaTeX @font-face without a woff2 source: ${sources}`);
    }
    fontFaces += 1;
    const font = readFileSync(
      join(katexFontsDir, woff2[1].slice("fonts/".length)),
    );
    return `src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")`;
  },
);
if (fontFaces === 0) {
  throw new Error("No @font-face rules found in katex/dist/katex.min.css");
}
writeGenerated(
  "../src/lib/components/chat/katex-stylesheet.ts",
  `// Generated from katex/dist/katex.min.css with only woff2 fonts. Do not edit.\nexport const katexStylesheet = ${JSON.stringify(katexStylesheet)};\n`,
);
