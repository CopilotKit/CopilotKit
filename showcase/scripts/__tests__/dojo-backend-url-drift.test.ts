import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// shell-dojo's src/lib/backend-url.ts is a VERBATIM copy of the shell's
// (scripts cannot be imported across the two Next apps, and lifting it
// to a shared importable package was the larger-blast-radius option).
// The copy's only failure mode is drift — these guards make drift a CI
// failure instead of a silent staging→prod leakage. The behavior itself
// is covered by shell/src/lib/backend-url.test.ts; here we only assert
// the two files (and the script-side default) stay in lockstep.

const SHELL_BACKEND_URL = resolve(
  __dirname,
  "..",
  "..",
  "shell",
  "src",
  "lib",
  "backend-url.ts",
);
const DOJO_BACKEND_URL = resolve(
  __dirname,
  "..",
  "..",
  "shell-dojo",
  "src",
  "lib",
  "backend-url.ts",
);
const GENERATE_REGISTRY = resolve(__dirname, "..", "generate-registry.ts");

function defaultPatternIn(source: string): string {
  const match = source.match(
    /DEFAULT_BACKEND_HOST_PATTERN\s*=\s*\n?\s*"([^"]+)"/,
  );
  if (!match) {
    throw new Error("DEFAULT_BACKEND_HOST_PATTERN literal not found");
  }
  return match[1];
}

describe("shell-dojo backend-url drift guard", () => {
  it("shell-dojo/backend-url.ts is byte-identical to shell/backend-url.ts", () => {
    const shell = readFileSync(SHELL_BACKEND_URL, "utf8");
    const dojo = readFileSync(DOJO_BACKEND_URL, "utf8");
    // If this fails, re-copy shell/src/lib/backend-url.ts over
    // shell-dojo/src/lib/backend-url.ts (do NOT diverge them — port any
    // intended change to the shell first, then re-copy).
    expect(dojo).toBe(shell);
  });

  it("the default host pattern matches between backend-url.ts and generate-registry.ts", () => {
    // backend-url.ts (runtime consumer) and generate-registry.ts
    // (build-time synthesizer) consume the same SHOWCASE_BACKEND_HOST_PATTERN
    // env var and MUST agree on the unset-default, or an unset deploy
    // would bake one host yet derive another at runtime.
    const runtimeDefault = defaultPatternIn(
      readFileSync(SHELL_BACKEND_URL, "utf8"),
    );
    const scriptDefault = defaultPatternIn(
      readFileSync(GENERATE_REGISTRY, "utf8"),
    );
    expect(runtimeDefault).toBe(scriptDefault);
    expect(runtimeDefault).toBe("showcase-{slug}-production.up.railway.app");
  });
});
