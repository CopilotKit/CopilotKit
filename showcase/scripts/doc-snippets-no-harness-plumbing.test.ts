// Guard: harness-only plumbing must never appear in bundled doc snippets.
//
// Showcase agents use harness-only constructs at runtime (aimock header
// forwarding, CVDIAG diagnostics) that are wrong/unresolvable in a reader's
// project. They are kept out of doc snippets via `@doc-replace/@doc-as`
// markers (see doc-swap.ts). This test regenerates the snippet bundles and
// asserts none of those identifiers survive into the published output, so a
// new demo that forgets the markers fails CI instead of shipping plumbing.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE = path.resolve(__dirname, "..");

// Identifiers that only make sense inside the test harness.
const FORBIDDEN = [
  "makeChatOpenAI",
  "openai-headers",
  "withForwardedHeaders",
  "_header_forwarding",
  "withCvdiagBackend",
  "CVDIAG",
  "x-aimock-context",
  "x-diag-hops",
  "x-diag-run-id",
  "copilotkit_forwarded_headers",
];

const BUNDLES = [
  "shell-docs/src/data/demo-content.json",
  "shell-docs/src/data/setup-content.json",
  "shell/src/data/demo-content.json",
  "shell-dojo/src/data/demo-content.json",
];

function regenerate() {
  for (const script of ["bundle-demo-content.ts", "bundle-setup-content.ts"]) {
    execFileSync("npx", ["tsx", path.join("scripts", script)], {
      cwd: SHOWCASE,
      stdio: "pipe",
    });
  }
}

describe("doc snippets contain no harness-only plumbing", () => {
  beforeAll(() => {
    regenerate();
  }, 120_000);

  for (const bundle of BUNDLES) {
    it(`${bundle} is clean`, () => {
      const content = readFileSync(path.join(SHOWCASE, bundle), "utf-8");
      const offenders = FORBIDDEN.filter((id) => content.includes(id));
      expect(
        offenders,
        `harness identifiers found in ${bundle}: ${offenders.join(", ")}. ` +
          `Wrap the harness-only lines in @doc-replace/@doc-as markers (see doc-swap.ts).`,
      ).toEqual([]);
    });
  }
});
