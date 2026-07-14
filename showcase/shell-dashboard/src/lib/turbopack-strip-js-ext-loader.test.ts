/**
 * Unit tests for the Turbopack transform loader that strips explicit `.js`
 * extensions off RELATIVE import/export specifiers so the harness cell-model
 * fold resolves to its `.ts` sources under Turbopack.
 *
 * These tests pin the HARDENED behavior: the loader must strip `.js`/`.mjs`/
 * `.cjs` off real relative import/export specifiers (static, bare side-effect,
 * and dynamic forms) while NEVER mutating a `.js` occurrence that lives inside
 * ordinary string data or a comment.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The loader is a CommonJS `.cjs` module in the package root; load it via
// createRequire so this ESM test can `require` it without a build step.
const require = createRequire(import.meta.url);
const stripRelativeJsExtensions =
  require("../../turbopack-strip-js-ext-loader.cjs") as (
    source: string,
    map?: unknown,
  ) => string;

/**
 * Invoke the loader with a fake webpack-loader `this` so `this.callback` /
 * `this.async` (used to forward sourcemaps) resolve. Returns the emitted
 * `{ code, map }` regardless of whether the loader returns a string or calls
 * `this.callback`.
 */
function run(source: string, map?: unknown): { code: string; map: unknown } {
  let out: { code: string; map: unknown } | undefined;
  const ctx = {
    callback(_err: unknown, code: string, forwardedMap?: unknown) {
      out = { code, map: forwardedMap };
    },
    // Some loaders call `this.async()` and use the returned callback instead.
    async() {
      return (_err: unknown, code: string, forwardedMap?: unknown) => {
        out = { code, map: forwardedMap };
      };
    },
  };
  const returned = stripRelativeJsExtensions.call(ctx, source, map);
  if (out) return out;
  return { code: returned, map: undefined };
}

describe("turbopack-strip-js-ext-loader", () => {
  it("strips .js off a real static relative import/re-export specifier", () => {
    expect(run(`import { formatTs } from "./format-ts.js";`).code).toBe(
      `import { formatTs } from "./format-ts";`,
    );
    expect(run(`export { x } from "../a/b.js";`).code).toBe(
      `export { x } from "../a/b";`,
    );
    expect(run(`export * from "./staleness.js";`).code).toBe(
      `export * from "./staleness";`,
    );
  });

  it("strips .js off a multi-line import whose `from` clause is line-anchored", () => {
    const src = [
      "import {",
      "  keyFor,",
      "  STARTER_LEVELS,",
      '} from "./live-status.js";',
    ].join("\n");
    const expected = [
      "import {",
      "  keyFor,",
      "  STARTER_LEVELS,",
      '} from "./live-status";',
    ].join("\n");
    expect(run(src).code).toBe(expected);
  });

  it("strips .js off a bare side-effect relative import", () => {
    expect(run(`import "./polyfill.js";`).code).toBe(`import "./polyfill";`);
  });

  it("strips .js off a dynamic relative import", () => {
    expect(run(`const m = await import("./lazy.js");`).code).toBe(
      `const m = await import("./lazy");`,
    );
  });

  it("strips .mjs and .cjs off relative specifiers (webpack extensionAlias parity)", () => {
    expect(run(`import { a } from "./x.mjs";`).code).toBe(
      `import { a } from "./x";`,
    );
    expect(run(`export { b } from "./y.cjs";`).code).toBe(
      `export { b } from "./y";`,
    );
  });

  it("does NOT touch bare/package specifiers", () => {
    expect(run(`import x from "react.js";`).code).toBe(
      `import x from "react.js";`,
    );
    expect(run(`import y from "pkg/entry.js";`).code).toBe(
      `import y from "pkg/entry.js";`,
    );
  });

  it("does NOT mutate a `.js` occurrence inside string data", () => {
    const src = `const s = 'see ./foo.js';`;
    expect(run(src).code).toBe(src);
  });

  it("does NOT mutate a `.js` occurrence inside a line comment", () => {
    const src = `// ./bar.js is the old path`;
    expect(run(src).code).toBe(src);
  });

  it('does NOT mutate `from "./x.js"`-shaped text inside a template literal', () => {
    const src = 'const t = `import a from "./tpl.js";`;';
    expect(run(src).code).toBe(src);
  });

  it("strips only the real specifier when real + string-data coexist", () => {
    const src = [
      `import { formatTs } from "./format-ts.js";`,
      `const doc = 'the module lives at ./format-ts.js';`,
      `// re-export from "./format-ts.js" historically`,
    ].join("\n");
    const expected = [
      `import { formatTs } from "./format-ts";`,
      `const doc = 'the module lives at ./format-ts.js';`,
      `// re-export from "./format-ts.js" historically`,
    ].join("\n");
    expect(run(src).code).toBe(expected);
  });

  // CR round-2 regression guards: the earlier line-anchored-regex loader
  // corrupted these because a line-leading `from` inside a multi-line template,
  // and an `import("…")` call shape inside any literal/comment, both matched.
  // The mask-then-match loader must leave all of them untouched.
  it("does NOT mutate a line-leading `from` inside a multi-line template", () => {
    const src = 'const t = `\n} from "./inside.js"`;';
    expect(run(src).code).toBe(src);
    const src2 = 'const t = `\nfrom "./inside.js"`;';
    expect(run(src2).code).toBe(src2);
  });

  it("does NOT mutate a dynamic `import(...)` inside a string/template/comment", () => {
    const tpl = 'const s = `await import("./tpl.js")`;';
    expect(run(tpl).code).toBe(tpl);
    const str = `const s = 'import("./str.js")';`;
    expect(run(str).code).toBe(str);
    const cmt = `// example: import("./doc.js")`;
    expect(run(cmt).code).toBe(cmt);
  });

  it("does NOT mutate a `.js` specifier shape inside a block comment", () => {
    const src = `/* import z from "./c.js"; */`;
    expect(run(src).code).toBe(src);
  });

  it("preserves a directory segment literally named `foo.js`", () => {
    expect(run(`import q from "./foo.js/index.js";`).code).toBe(
      `import q from "./foo.js/index";`,
    );
  });

  it("forwards the incoming sourcemap", () => {
    const map = { version: 3, sources: ["x.ts"], mappings: "AAAA" };
    const result = run(`import { a } from "./x.js";`, map);
    expect(result.code).toBe(`import { a } from "./x";`);
    expect(result.map).toEqual(map);
  });
});
