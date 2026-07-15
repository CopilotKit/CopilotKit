import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = readFileSync(
  resolve(ROOT, ".github/workflows/publish-release.yml"),
  "utf8",
);

describe("Channels stable publish workflow", () => {
  it("publishes prerequisites, verifies the registry, then publishes the umbrella", () => {
    const dependencies = workflow.indexOf(
      'scripts/release/publish-release.ts --scope "$SCOPE" --phase dependencies',
    );
    const verifier = workflow.indexOf(
      "Verify registry-backed Channels umbrella contract",
    );
    const umbrella = workflow.indexOf(
      'scripts/release/publish-release.ts --scope "$SCOPE" --phase umbrella',
    );

    expect(dependencies).toBeGreaterThan(-1);
    expect(verifier).toBeGreaterThan(dependencies);
    expect(umbrella).toBeGreaterThan(verifier);
    expect(
      workflow.match(/Verify registry-backed Channels umbrella contract/g),
    ).toHaveLength(1);
  });
});
