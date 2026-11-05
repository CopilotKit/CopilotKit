import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stylesheet } from "@copilotkit/core/styles";

/** Writes a generated file, only when its content changed. */
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
// write a copy of the stylesheet that lists only the woff2 file of each font,
// next to those files. ng-packagr embeds only these 20 files, and an app that
// compiles this source emits them as separate font files.
const require = createRequire(import.meta.url);
const katexCssPath = require.resolve("katex/dist/katex.min.css");
const katexFontsDir = join(dirname(katexCssPath), "fonts");
const katexOutDir = fileURLToPath(
  new URL("../src/lib/components/chat/katex/", import.meta.url),
);
mkdirSync(join(katexOutDir, "fonts"), { recursive: true });
let fontFaces = 0;
const katexStylesheet = readFileSync(katexCssPath, "utf8").replace(
  /src:([^;}]+)/g,
  (_, sources) => {
    const woff2 = /url\((fonts\/[^)]+\.woff2)\)/.exec(sources);
    if (!woff2) {
      throw new Error(`KaTeX @font-face without a woff2 source: ${sources}`);
    }
    fontFaces += 1;
    const fontFile = woff2[1].slice("fonts/".length);
    copyFileSync(
      join(katexFontsDir, fontFile),
      join(katexOutDir, "fonts", fontFile),
    );
    return `src:url(${woff2[1]}) format("woff2")`;
  },
);
if (fontFaces === 0) {
  throw new Error("No @font-face rules found in katex/dist/katex.min.css");
}
writeGenerated(
  "../src/lib/components/chat/katex/katex.css",
  `/* Generated from katex/dist/katex.min.css with only woff2 fonts. Do not edit. */\n${katexStylesheet}\n`,
);
