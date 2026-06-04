import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Static assertion: every E2E driver source file must contain both
// "X-Test-Id" and "X-AIMock-Context" header strings. This guards against
// accidental removal of traceability headers during refactors.

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

  it("d6-all-pills.ts contains X-Test-Id and X-AIMock-Context", () => {
    const src = readDriver("d6-all-pills.ts");
    expect(src).toContain("X-Test-Id");
    expect(src).toContain("X-AIMock-Context");
  });
});
