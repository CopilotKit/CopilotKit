// Fails if the built /v2/headless chunk references the chat-message rendering
// stack. That entry exists so consumers with a custom UI — and all of
// @copilotkit/react-native — can import hooks without the ~5.5 MB shiki
// grammars/themes plus mermaid, cytoscape and katex (issue #4893).
//
// This is a STRUCTURAL assertion, not a size budget: it names the specific
// regression instead of guarding a byte threshold, so it hard-fails legitimately
// and needs no baseline maintenance. Size *budgets* remain blocked on OSS-122 —
// see dev-docs/bundle-size.md.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FORBIDDEN = ["shiki", "mermaid", "cytoscape", "katex", "streamdown"];
const dist = path.resolve(import.meta.dirname, "../dist/v2");
const targets = ["headless.mjs", "headless.cjs"];

let failed = false;
for (const file of targets) {
  const full = path.join(dist, file);
  if (!fs.existsSync(full)) {
    console.error(
      `✗ ${file} not found — run \`nx run @copilotkit/react-core:build\` first`,
    );
    failed = true;
    continue;
  }
  const code = fs.readFileSync(full, "utf8");
  const hits = FORBIDDEN.filter((dep) => code.includes(dep));
  if (hits.length) {
    console.error(
      `✗ ${file} references the heavy render stack: ${hits.join(", ")}`,
    );
    failed = true;
  } else {
    console.log(`✓ ${file} (${fs.statSync(full).size} B) — clean`);
  }
}

if (failed) {
  console.error(
    "\nThe /v2/headless entry must not link the chat-message rendering stack (#4893).\n" +
      "If a hook you added needs it, it belongs in the main /v2 entry instead.",
  );
  process.exit(1);
}
