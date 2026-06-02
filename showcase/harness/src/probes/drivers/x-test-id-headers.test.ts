import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Static assertion: the IN-PROCESS-pooled E2E driver sources (d4/d5) must each
// contain both "X-Test-Id" and "X-AIMock-Context" header strings. This guards
// against accidental removal of traceability headers during refactors.
//
// D6 is intentionally NOT covered here: it is fully spec-driven (it spawns the
// integration's own Playwright suite) and no longer carries an in-process
// browser launcher, so the per-context X-Test-Id / X-AIMock-Context headers are
// set by the gold specs' Playwright config, not by the driver source. The
// header strings were removed from d6-all-pills.ts along with the dead pooled
// launcher.

const __dirname = dirname(fileURLToPath(import.meta.url));

function readDriver(filename: string): string {
  return readFileSync(resolve(__dirname, filename), "utf-8");
}

describe("X-Test-Id header presence in E2E drivers", () => {
  it("d4-chat-roundtrip.ts contains X-Test-Id and X-AIMock-Context", () => {
    const src = readDriver("d4-chat-roundtrip.ts");
    expect(src).toContain("X-Test-Id");
    expect(src).toContain("X-AIMock-Context");
  });

  it("d5-single-pill.ts contains X-Test-Id and X-AIMock-Context", () => {
    const src = readDriver("d5-single-pill.ts");
    expect(src).toContain("X-Test-Id");
    expect(src).toContain("X-AIMock-Context");
  });
});
