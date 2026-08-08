// Fails if a React-Native-reachable chunk references the chat-message rendering
// stack. @copilotkit/react-native imports two react-core entries — /v2/headless
// and /v2/context — and neither may drag the ~5.5 MB shiki grammars/themes plus
// mermaid, cytoscape and katex (issue #4893). This script guards both built
// chunks: the /v2/headless entry exists so consumers with a custom UI can import
// hooks without that weight, and /v2/context carries CopilotKitCoreReact, so its
// transitive subtree must stay clean too. (The RN import-graph guard in
// packages/react-native/src/__tests__/headless-entry-surface.test.ts allows these
// same two entries but cannot follow into node_modules — this script does.)
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
const targets = ["headless.mjs", "headless.cjs", "context.mjs", "context.cjs"];

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
    "\nThe React-Native-reachable entries (/v2/headless, /v2/context) must not link\n" +
      "the chat-message rendering stack (#4893).\n" +
      "If a hook you added needs it, it belongs in the main /v2 entry instead.",
  );
  process.exit(1);
}
