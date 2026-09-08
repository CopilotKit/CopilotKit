import assert from "node:assert/strict";
import test from "node:test";

import {
  RETIRED_ANTHROPIC_MODELS,
  findRetiredAnthropicModels,
} from "../validate-retired-anthropic-models.mjs";

const oldSonnet = ["claude", "3", "5", "sonnet", "20241022"].join("-");
const oldAlias = ["claude", "sonnet", "4"].join("-");

test("reports retired dated IDs and aliases with their locations", () => {
  const source = `model=${oldSonnet}\nfallback=${oldAlias}`;

  assert.deepEqual(findRetiredAnthropicModels("config.ts", source), [
    { file: "config.ts", line: 1, model: oldSonnet },
    { file: "config.ts", line: 2, model: oldAlias },
  ]);
});

test("accepts active model identifiers", () => {
  const source = [
    ["claude", "sonnet", "4", "6"].join("-"),
    ["claude", "opus", "4", "8"].join("-"),
    ["claude", "haiku", "4", "5", "20251001"].join("-"),
  ].join("\n");

  assert.deepEqual(findRetiredAnthropicModels("config.ts", source), []);
});

test("keeps the official retired-model inventory unique", () => {
  assert.equal(
    RETIRED_ANTHROPIC_MODELS.length,
    new Set(RETIRED_ANTHROPIC_MODELS).size,
  );
});
