import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { loadQuickJS } from "../skill-registry/quickjs-loader";
import type { RequireLike } from "../skill-registry/quickjs-loader";
import { QUICKJS_WASM_BASE64 } from "../skill-registry/quickjs-wasm.generated";

const requireHere = createRequire(import.meta.url) as RequireLike;
const EMSCRIPTEN_MODULE =
  "@jitl/quickjs-wasmfile-release-sync/emscripten-module";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("loadQuickJS", () => {
  it("embeds the WebAssembly of the installed QuickJS package", () => {
    const installed = readFileSync(
      requireHere.resolve("@jitl/quickjs-wasmfile-release-sync/wasm"),
    );
    expect(sha256(Buffer.from(QUICKJS_WASM_BASE64, "base64"))).toBe(
      sha256(installed),
    );
  });

  it("gives QuickJS the WebAssembly bytes, so it never looks for a .wasm file", async () => {
    const wasmSizes: number[] = [];
    const requireFrom = ((specifier: string) => {
      const loaded = requireHere(specifier);
      if (specifier !== EMSCRIPTEN_MODULE) return loaded;
      const factory = loaded.default ?? loaded;
      return (options: { wasmBinary?: ArrayBuffer }) => {
        wasmSizes.push(options?.wasmBinary?.byteLength ?? 0);
        return factory(options);
      };
    }) as RequireLike;
    requireFrom.resolve = requireHere.resolve;

    const quickjs = await loadQuickJS(requireFrom);

    expect(quickjs.evalCode("1 + 1")).toBe(2);
    expect(wasmSizes).toHaveLength(1);
    expect(wasmSizes[0]).toBeGreaterThan(0);
  });

  it("names the bundler setting when the sandbox cannot load", async () => {
    const requireFrom = (() => {
      throw new Error("Cannot find module");
    }) as unknown as RequireLike;

    await expect(loadQuickJS(requireFrom)).rejects.toThrow(
      /serverExternalPackages/,
    );
  });
});
