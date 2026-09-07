import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findImportViolations,
  formatViolations,
  packageNameOf,
} from "../validate-dts-imports.js";

interface Fixture {
  /** Files to write under `dist/`, keyed by path relative to it. */
  dist: Record<string, string>;
  /** The package's own manifest. */
  manifest: Record<string, unknown>;
  /** Packages to fake under `node_modules/`, keyed by name. */
  installed?: Record<string, Record<string, unknown>>;
}

function setup({ dist, manifest, installed = {} }: Fixture): {
  distDir: string;
  root: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-dts-imports-"));
  const distDir = path.join(root, "dist");

  for (const [relative, contents] of Object.entries(dist)) {
    const full = path.join(distDir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", ...manifest }),
  );

  for (const [name, packageJson] of Object.entries(installed)) {
    const dir = path.join(root, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, ...packageJson }),
    );
  }

  return { distDir, root };
}

describe("findImportViolations", () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("flags the graphql-yoga type that shipped in OSS-899", () => {
    const fixture = setup({
      dist: {
        "index.d.cts": 'import { YogaInitialContext } from "graphql-yoga";',
      },
      manifest: { dependencies: { "graphql-yoga": "^5.3.1" } },
    });
    root = fixture.root;

    const violations = findImportViolations(fixture.distDir, fixture.root);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: "index.d.cts",
      line: 1,
      specifier: "graphql-yoga",
    });
    // Declared as a real dependency, so only the explicit ban catches it.
    expect(violations[0].reason).toContain("retired");
  });

  it("flags a relative import of a bundler chunk emitted as JavaScript only", () => {
    const fixture = setup({
      dist: {
        "channels/index.d.cts":
          'import { __exportAll } from "../_virtual/_rolldown/runtime.cjs";',
        "_virtual/_rolldown/runtime.cjs": "module.exports = {};",
      },
      manifest: {},
    });
    root = fixture.root;

    expect(findImportViolations(fixture.distDir, fixture.root)).toEqual([
      {
        file: path.join("channels", "index.d.cts"),
        line: 1,
        specifier: "../_virtual/_rolldown/runtime.cjs",
        reason: "relative import has no declaration file next to it",
      },
    ]);
  });

  it("flags an optional peer dependency a consumer may not have installed", () => {
    const fixture = setup({
      dist: { "adapter.d.cts": 'import Anthropic from "@anthropic-ai/sdk";' },
      manifest: {
        peerDependencies: { "@anthropic-ai/sdk": ">=0.57.0" },
        peerDependenciesMeta: { "@anthropic-ai/sdk": { optional: true } },
      },
    });
    root = fixture.root;

    const violations = findImportViolations(fixture.distDir, fixture.root);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("optional peer");
  });

  it("flags a devDependency, which consumers never install", () => {
    const fixture = setup({
      dist: { "index.d.cts": 'import type { X } from "@copilotkit/channels";' },
      manifest: { devDependencies: { "@copilotkit/channels": "workspace:*" } },
    });
    root = fixture.root;

    const violations = findImportViolations(fixture.distDir, fixture.root);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("devDependency");
  });

  it("flags a dependency whose types live in a devDependency @types package", () => {
    const fixture = setup({
      dist: { "express.d.cts": 'import type { CorsOptions } from "cors";' },
      manifest: {
        dependencies: { cors: "^2.8.5" },
        devDependencies: { "@types/cors": "^2.8.17" },
      },
      installed: { cors: { main: "lib/index.js" } },
    });
    root = fixture.root;

    const violations = findImportViolations(fixture.distDir, fixture.root);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("@types/cors must be a dependency");
  });

  it("accepts a dependency once its @types package is promoted to a dependency", () => {
    const fixture = setup({
      dist: { "express.d.cts": 'import type { CorsOptions } from "cors";' },
      manifest: {
        dependencies: { cors: "^2.8.5", "@types/cors": "^2.8.17" },
      },
      installed: { cors: { main: "lib/index.js" } },
    });
    root = fixture.root;

    expect(findImportViolations(fixture.distDir, fixture.root)).toEqual([]);
  });

  it("accepts builtins, resolvable relatives, real deps, and required peers", () => {
    const fixture = setup({
      dist: {
        "index.d.cts": [
          'import { Readable } from "node:stream";',
          'import { EventEmitter } from "events";',
          'import type { Foo } from "./foo.cjs";',
          'import type { Bar } from "./nested/index.cjs";',
          'export * from "@copilotkit/channels-core";',
          'import type { OpenAI } from "openai";',
        ].join("\n"),
        "foo.d.cts": "export type Foo = string;",
        "nested/index.d.cts": "export type Bar = number;",
      },
      manifest: {
        dependencies: { "@copilotkit/channels-core": "workspace:^" },
        peerDependencies: { openai: ">=5.0.0" },
      },
      installed: {
        "@copilotkit/channels-core": { types: "./dist/index.d.ts" },
        openai: { types: "./index.d.ts" },
      },
    });
    root = fixture.root;

    expect(findImportViolations(fixture.distDir, fixture.root)).toEqual([]);
  });
});

describe("packageNameOf", () => {
  it("keeps the scope for scoped packages and drops subpaths", () => {
    expect(packageNameOf("groq-sdk/resources/chat")).toBe("groq-sdk");
    expect(packageNameOf("@langchain/langgraph-sdk/dist/types")).toBe(
      "@langchain/langgraph-sdk",
    );
    expect(packageNameOf("cors")).toBe("cors");
  });
});

describe("formatViolations", () => {
  it("is empty when there is nothing to report", () => {
    expect(formatViolations([], "dist")).toBe("");
  });

  it("names the file, line, specifier, and reason", () => {
    const output = formatViolations(
      [
        {
          file: "index.d.cts",
          line: 3,
          specifier: "groq-sdk",
          reason: "optional peer dependency -- consumers may not install it",
        },
      ],
      "dist",
    );

    expect(output).toContain("dist/index.d.cts:3");
    expect(output).toContain('"groq-sdk"');
    expect(output).toContain("optional peer dependency");
  });
});
