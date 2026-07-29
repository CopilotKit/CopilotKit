/**
 * spec-cell-mapping.base — freshness + content contract test.
 *
 * `base.json` is the full `REGISTRY_TO_D5` map serialized (stem -> cells),
 * materialized by the checked-in generator (scripts/generate-spec-cell-mapping.ts).
 *
 * Three contracts:
 *   1. Key count equals the number of registry entries (43 on branch).
 *   2. FRESHNESS / byte contract: the file bytes equal serializeBase(REGISTRY_TO_D5)
 *      (sorted keys + trailing newline). Read raw bytes — NOT JSON.stringify(baseJson)
 *      (which re-serializes in import order, diverging from the sorted --check contract).
 *   3. CONTENT contract: the parsed object deep-equals the registry map (order-independent).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REGISTRY_TO_D5 } from "./d5-feature-mapping.js";
import baseJson from "./spec-cell-mapping.base.json" with { type: "json" };
import { serializeBase } from "../../../scripts/generate-spec-cell-mapping.js";

const BASE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "spec-cell-mapping.base.json",
);

describe("base.json is REGISTRY_TO_D5 serialized (stem -> cells)", () => {
  it("has exactly one key per registry entry (43)", () => {
    expect(Object.keys(baseJson).length).toBe(
      Object.keys(REGISTRY_TO_D5).length,
    );
  });

  it("byte-matches serializeBase(REGISTRY_TO_D5) (freshness contract)", () => {
    expect(readFileSync(BASE_PATH, "utf-8")).toBe(
      serializeBase(REGISTRY_TO_D5),
    );
  });

  it("deep-equals REGISTRY_TO_D5 as content", () => {
    expect(baseJson).toEqual(REGISTRY_TO_D5);
  });
});
