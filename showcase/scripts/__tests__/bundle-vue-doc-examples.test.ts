import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeRelativePath,
  createVueDocExamplesBundle,
} from "../bundle-vue-doc-examples.js";

const temporaryDirectories: string[] = [];

function fixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vue-doc-examples-"));
  temporaryDirectories.push(directory);
  return directory;
}

function write(root: string, file: string, source: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("createVueDocExamplesBundle", () => {
  it("sorts files and regions deterministically while stripping markers", () => {
    const root = fixture();
    write(
      root,
      "z.vue",
      "<!-- @region[zeta] -->\n<template>Z</template>\n<!-- @endregion[zeta] -->\n",
    );
    write(
      root,
      "a.ts",
      [
        "// @region[second]",
        "const second = 2;",
        "// @endregion[second]",
        "// @region[first]",
        "const first = 1;",
        "// @endregion[first]",
        "",
      ].join("\n"),
    );

    const bundle = createVueDocExamplesBundle(root);

    expect(Object.keys(bundle.files)).toEqual(["a.ts", "z.vue"]);
    expect(Object.keys(bundle.files["a.ts"].regions)).toEqual([
      "first",
      "second",
    ]);
    expect(bundle.files["z.vue"].language).toBe("vue");
    expect(bundle.files["z.vue"].code).toBe("<template>Z</template>\n");
    expect(bundle.files["z.vue"].regions.zeta.code).toBe(
      "<template>Z</template>",
    );
  });

  it("rejects a missing or empty source tree", () => {
    const root = fixture();
    expect(() =>
      createVueDocExamplesBundle(path.join(root, "missing")),
    ).toThrow(/source root is missing/);
    expect(() => createVueDocExamplesBundle(root)).toThrow(
      /No Vue documentation/,
    );
  });

  it("rejects duplicate region identifiers within one file", () => {
    const root = fixture();
    write(
      root,
      "duplicate.ts",
      [
        "// @region[same]",
        "const one = 1;",
        "// @endregion[same]",
        "// @region[same]",
        "const two = 2;",
        "// @endregion[same]",
      ].join("\n"),
    );

    expect(() => createVueDocExamplesBundle(root)).toThrow(
      /duplicate @region\[same\]/,
    );
  });

  it("rejects unsupported source types", () => {
    const root = fixture();
    write(root, "README.md", "# Not source");
    expect(() => createVueDocExamplesBundle(root)).toThrow(
      /Unsupported Vue documentation example source type/,
    );
  });
});

describe("assertSafeRelativePath", () => {
  it.each(["../secret.ts", "/absolute.ts", "nested\\windows.ts", ""])(
    "rejects unsafe path %j",
    (file) => {
      expect(() => assertSafeRelativePath(file)).toThrow(/Unsafe/);
    },
  );

  it("accepts normalized source paths", () => {
    expect(() => assertSafeRelativePath("quickstart/App.vue")).not.toThrow();
  });
});
