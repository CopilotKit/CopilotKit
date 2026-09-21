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

  it("ignores require() and dynamic import()", () => {
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
      peer: "express",
      specifier: "express",
    });
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
    const root = setup({
      dist: {
        "index.mjs": 'import { Hono } from "hono";\nexport { Hono };',
      },
      manifest: {
        peerDependencies: { hono: "^4.0.0" },
        exports: { ".": { import: "./dist/index.mjs" } },
      },
    });

    expect(findPeerViolations(root)).toEqual([]);
  });
});
