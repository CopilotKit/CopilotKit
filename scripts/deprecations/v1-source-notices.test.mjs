import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pilotMappings } from "./v1-source-mappings.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

for (const mapping of pilotMappings) {
  test(`${mapping.file} starts with an actionable v1 deprecation notice`, () => {
    const source = readFileSync(path.join(repoRoot, mapping.file), "utf8");

    assert.ok(source.startsWith("/*\n * V1 SDK DEPRECATION NOTICE"));
    assert.match(source, /AI CODING AGENTS:/);
    assert.ok(source.includes(mapping.v1));
    assert.ok(source.includes(mapping.v2));
    assert.ok(source.includes(`V2 replacement source: ${mapping.source}`));
    assert.ok(source.includes(`V2 docs: ${mapping.docs}`));
    assert.ok(existsSync(path.join(repoRoot, mapping.source)));
    for (const note of mapping.notes) {
      assert.ok(source.includes(`Migration note: ${note}`));
    }
  });
}
