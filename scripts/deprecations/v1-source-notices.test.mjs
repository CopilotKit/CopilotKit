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
  test(`${mapping.file} says the v1 SDK is deprecated and to use v2 instead`, () => {
    const source = readFileSync(path.join(repoRoot, mapping.file), "utf8");

    assert.ok(source.startsWith("/*\n * V1 SDK DEPRECATED. USE V2 INSTEAD"));
    assert.match(source, /AI CODING AGENTS:/);
    assert.doesNotMatch(source, /In most packages, v1 is the/);
    assert.doesNotMatch(source, /package root/);
    assert.ok(source.includes(mapping.v1));
    assert.ok(source.includes(mapping.v2));
    assert.ok(source.includes(`V2 replacement source: ${mapping.source}`));
    assert.ok(source.includes(`V2 docs: ${mapping.docs}`));
    assert.ok(existsSync(path.join(repoRoot, mapping.source)));
    for (const note of mapping.notes) {
      assert.ok(source.includes(`Migration note: ${note}`));
    }

    const notice = source.slice(
      0,
      source.indexOf("END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE"),
    );
    for (const noticeLine of notice
      .split("\n")
      .filter((candidate) => /deprecat/i.test(candidate))) {
      assert.match(noticeLine, /use v2 instead/i);
    }
  });
}
