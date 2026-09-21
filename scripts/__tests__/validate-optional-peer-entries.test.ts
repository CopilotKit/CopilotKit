import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findPeerViolations,
  isDedicatedEntry,
  packageNameOf,
  reachableBareSpecifiers,
} from "../validate-optional-peer-entries.js";

interface Fixture {
  /** Files to write under `dist/`, keyed by path relative to it. */
  dist: Record<string, string>;
  /** The package's own manifest, merged over the name. */
  manifest: Record<string, unknown>;
}

const created: string[] = [];

function setup({ dist, manifest }: Fixture): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-peer-entries-"));
  created.push(root);

  for (const [relative, contents] of Object.entries(dist)) {
    const full = path.join(root, "dist", relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", ...manifest }),
  );
  return root;
}

const OPTIONAL_EXPRESS = {
  peerDependencies: { express: "^5.0.0" },
  peerDependenciesMeta: { express: { optional: true } },
};

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

describe("packageNameOf", () => {
  it("keeps the scope for a scoped subpath", () => {
    expect(packageNameOf("@langchain/core/messages")).toBe("@langchain/core");
  });

  it("drops the subpath for an unscoped specifier", () => {
    expect(packageNameOf("express/lib/router")).toBe("express");
  });
});

describe("isDedicatedEntry", () => {
  it("treats a matching path segment as dedicated", () => {
    expect(isDedicatedEntry("./v2/express", "express")).toBe(true);
  });

  it("does not treat a barrel as dedicated", () => {
    expect(isDedicatedEntry("./v2", "express")).toBe(false);
    expect(isDedicatedEntry(".", "express")).toBe(false);
  });

  it("matches a scoped peer on its last segment", () => {
    expect(isDedicatedEntry("./langgraph", "@langchain/langgraph-sdk")).toBe(
      false,
    );
    expect(isDedicatedEntry("./core", "@langchain/core")).toBe(true);
  });
});

describe("reachableBareSpecifiers", () => {
  it("follows relative imports transitively", () => {
    const root = setup({
      dist: {
        "index.mjs": 'import "./a.mjs";',
        "a.mjs": 'import "./nested/b.mjs";',
        "nested/b.mjs": 'import x from "deep";\nexport { x };',
      },
      manifest: {},
    });
    const reached = reachableBareSpecifiers(path.join(root, "dist/index.mjs"));
    expect([...reached.keys()]).toEqual(["deep"]);
  });

  it("ignores require() and dynamic import() in an ESM module", () => {
    const root = setup({
      dist: {
        "index.mjs":
          'import { createRequire } from "node:module";\n' +
          'export const load = () => createRequire(import.meta.url)("lazy");\n' +
          'export const later = () => import("also-lazy");',
      },
      manifest: {},
    });
    const reached = reachableBareSpecifiers(path.join(root, "dist/index.mjs"));
    expect([...reached.keys()]).toEqual(["node:module"]);
  });

  it("refuses to walk past a relative specifier that resolves to nothing", () => {
    // A truncated walk would report "clean" for a graph it never traversed, and
    // a vacuous pass is indistinguishable from a real one. One renamed build
    // extension is enough to cause it.
    const root = setup({
      dist: { "index.mjs": 'export * from "./gone.mjs";' },
      manifest: {},
    });
    expect(() =>
      reachableBareSpecifiers(path.join(root, "dist/index.mjs")),
    ).toThrow(/resolves to no file/);
  });

  describe("cjs", () => {
    it("collects a top-level require and follows it", () => {
      const root = setup({
        dist: {
          "index.cjs": 'const a = require("./a.cjs");\nmodule.exports = a;',
          "a.cjs": 'const deep = require("deep");\nmodule.exports = deep;',
        },
        manifest: {},
      });
      const reached = reachableBareSpecifiers(
        path.join(root, "dist/index.cjs"),
        "cjs",
      );
      expect([...reached.keys()]).toEqual(["deep"]);
    });

    it("ignores a require inside a function body", () => {
      // The whole point of the lazy loader: the call runs only if the consumer
      // calls the factory. In a CJS bundle every static import is emitted as a
      // require, so position -- not syntax -- is what separates the two.
      const root = setup({
        dist: {
          "index.cjs":
            'function load() { return require("lazy"); }\n' +
            'const eager = require("eager");\n' +
            "module.exports = { load, eager };",
        },
        manifest: {},
      });
      const reached = reachableBareSpecifiers(
        path.join(root, "dist/index.cjs"),
        "cjs",
      );
      expect([...reached.keys()]).toEqual(["eager"]);
    });
  });
});

describe("findPeerViolations", () => {
  it("flags a barrel that statically imports an optional peer", () => {
    const root = setup({
      dist: {
        "v2/index.mjs": 'export * from "./endpoints/express.mjs";',
        "v2/endpoints/express.mjs":
          'import express from "express";\nexport { express };',
      },
      manifest: {
        ...OPTIONAL_EXPRESS,
        exports: { "./v2": { import: "./dist/v2/index.mjs" } },
      },
    });

    const violations = findPeerViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      entry: "./v2",
      format: "esm",
      peer: "express",
      specifier: "express",
    });
  });

  it("flags the require target too, not only the import target", () => {
    // A CJS consumer loads the `require` condition and never evaluates the ESM
    // one. Checking only `import` would leave that half of the published
    // package unguarded.
    const root = setup({
      dist: {
        "v2/index.mjs": "export const ok = true;",
        "v2/index.cjs":
          'const express = require("express");\nmodule.exports = { express };',
      },
      manifest: {
        ...OPTIONAL_EXPRESS,
        exports: {
          "./v2": {
            import: "./dist/v2/index.mjs",
            require: "./dist/v2/index.cjs",
          },
        },
      },
    });

    const violations = findPeerViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ entry: "./v2", format: "cjs" });
  });

  it("allows the entry point dedicated to that peer", () => {
    const root = setup({
      dist: {
        "v2/express.mjs": 'import express from "express";\nexport { express };',
      },
      manifest: {
        ...OPTIONAL_EXPRESS,
        exports: { "./v2/express": { import: "./dist/v2/express.mjs" } },
      },
    });

    expect(findPeerViolations(root)).toEqual([]);
  });

  it("passes when the peer is required at call time", () => {
    const root = setup({
      dist: {
        "v2/index.mjs": 'export * from "./endpoints/express.mjs";',
        "v2/endpoints/express.mjs":
          'import { createRequire } from "node:module";\n' +
          'export const make = () => createRequire(import.meta.url)("express").Router();',
      },
      manifest: {
        ...OPTIONAL_EXPRESS,
        exports: { "./v2": { import: "./dist/v2/index.mjs" } },
      },
    });

    expect(findPeerViolations(root)).toEqual([]);
  });

  it("ignores a peer that is not optional", () => {
    // Deliberately NOT the "." entry: that one carries a recorded exemption, so
    // a fixture mounted there would pass whether or not this rule works.
    const root = setup({
      dist: {
        "v2/index.mjs": 'import { Hono } from "hono";\nexport { Hono };',
      },
      manifest: {
        peerDependencies: { hono: "^4.0.0" },
        exports: { "./v2": { import: "./dist/v2/index.mjs" } },
      },
    });

    expect(findPeerViolations(root)).toEqual([]);
  });

  it("scopes a recorded exemption to the peer it was recorded for", () => {
    // The v1 root is allowed to reach `openai`. It is not allowed to reach
    // express: the whole point of #7278 was getting express out of that graph,
    // and an entry-level exemption would let it back in unannounced.
    const root = setup({
      dist: {
        "index.mjs": 'import "openai";\nimport "express";',
      },
      manifest: {
        peerDependencies: { express: "^5.0.0", openai: ">=5.0.0" },
        peerDependenciesMeta: {
          express: { optional: true },
          openai: { optional: true },
        },
        exports: { ".": { import: "./dist/index.mjs" } },
      },
    });

    const violations = findPeerViolations(root);
    expect(violations.map((v) => v.peer)).toEqual(["express"]);
  });
});
