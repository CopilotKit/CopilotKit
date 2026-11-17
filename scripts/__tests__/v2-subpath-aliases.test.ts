import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  v2AliasExports,
  writeV2Aliases,
} from "../deprecations/v2-subpath-aliases.mjs";

/** The `exports` that tsdown writes for a package with a root and `./node`. */
const BUILT_EXPORTS = {
  ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" },
  "./node": { import: "./dist/node.mjs", require: "./dist/node.cjs" },
  "./package.json": "./package.json",
};

const ALIASES = {
  entries: { "./v2": ".", "./v2/node": "./node" },
  stylesheets: ["./v2/styles.css"],
};

/** The root declarations. `extra` comes from a dependency that is not built yet. */
const ROOT_DECLARATIONS = [
  "export declare class Client { private secret; }",
  "export declare function connect(): Client;",
  "export type Options = { url: string };",
  'export * from "fixture-extra";',
].join("\n");

const NODE_DECLARATIONS = "export declare function listen(): void;";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots = [];
});

function writeFile(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/**
 * A project with the built package `fixture` in its `node_modules`, without
 * the alias files. `dist` maps the built files to their text.
 */
function setupProject(dist: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v2-subpath-aliases-"));
  roots.push(root);
  const packageDir = path.join(root, "node_modules", "fixture");
  writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "fixture",
      type: "module",
      types: "./dist/index.d.cts",
      typesVersions: {
        "*": {
          node: ["./dist/node.d.cts"],
          v2: ["./dist/v2/index.d.cts"],
          "v2/node": ["./dist/v2/node.d.cts"],
        },
      },
      exports: v2AliasExports(BUILT_EXPORTS, ALIASES),
    }),
  );
  for (const [file, text] of Object.entries(dist)) {
    writeFile(path.join(packageDir, "dist", file), text);
  }
  return { root, packageDir };
}

function setupBuiltProject() {
  return setupProject({
    "index.mjs": "export {};",
    "index.cjs": "module.exports = {};",
    "index.d.mts": ROOT_DECLARATIONS,
    "index.d.cts": ROOT_DECLARATIONS,
    "node.mjs": "export {};",
    "node.cjs": "module.exports = {};",
    "node.d.mts": NODE_DECLARATIONS,
    "node.d.cts": NODE_DECLARATIONS,
  });
}

/** Installs `fixture-extra`, the dependency that adds `extra`. */
function installExtra(root: string) {
  const dir = path.join(root, "node_modules", "fixture-extra");
  writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture-extra", types: "./index.d.ts" }),
  );
  writeFile(
    path.join(dir, "index.d.ts"),
    "export declare const extra: number;",
  );
}

/**
 * Type-checks `file` in `root` with the language service, as an editor
 * does. It returns the errors and the names reported as deprecated.
 */
function check(
  root: string,
  file: string,
  text: string,
  options: ts.CompilerOptions,
) {
  const fileName = path.join(root, file);
  writeFile(fileName, text);
  const compilerOptions = { strict: true, noEmit: true, ...options };
  const service = ts.createLanguageService({
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const content = ts.sys.readFile(name);
      return content === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  });
  const errors = service
    .getSemanticDiagnostics(fileName)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
  const deprecated = service
    .getSuggestionDiagnostics(fileName)
    .filter((diagnostic) => diagnostic.reportsDeprecated)
    .map((diagnostic) =>
      ts
        .flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        .replace(/^'(.+)' is deprecated\.$/, "$1"),
    );
  return { errors, deprecated: [...new Set(deprecated)].sort() };
}

const CONSUMER = [
  'import { Client, connect, extra, type Options } from "fixture/v2";',
  'import { listen } from "fixture/v2/node";',
  'import { Client as RootClient } from "fixture";',
  // The class has a private member, so this only compiles when the alias
  // and the root name the same declaration.
  "const fromRoot: RootClient = connect();",
  "const fromAlias: Client = fromRoot;",
  "const options: Options = { url: '' };",
  "export const used = [fromAlias, extra, listen, options];",
  "",
].join("\n");

describe("v2AliasExports", () => {
  it("points each alias at the 2.0 files and at its own declarations", () => {
    expect(v2AliasExports(BUILT_EXPORTS, ALIASES)).toEqual({
      ...BUILT_EXPORTS,
      "./v2": {
        import: { types: "./dist/v2/index.d.mts", default: "./dist/index.mjs" },
        require: {
          types: "./dist/v2/index.d.cts",
          default: "./dist/index.cjs",
        },
      },
      "./v2/node": {
        import: { types: "./dist/v2/node.d.mts", default: "./dist/node.mjs" },
        require: { types: "./dist/v2/node.d.cts", default: "./dist/node.cjs" },
      },
      "./v2/styles.css": "./dist/v2/styles.css",
    });
  });

  it("rejects an alias of a subpath that the build does not export", () => {
    expect(() =>
      v2AliasExports(BUILT_EXPORTS, {
        entries: { "./v2/express": "./express" },
        stylesheets: [],
      }),
    ).toThrow('"./express" (for "./v2/express")');
  });
});

describe("writeV2Aliases", () => {
  it("writes the declaration files and the stylesheet that the exports name", () => {
    const { packageDir } = setupBuiltProject();

    expect(writeV2Aliases(packageDir).sort()).toEqual([
      "./dist/v2/index.d.cts",
      "./dist/v2/index.d.mts",
      "./dist/v2/node.d.cts",
      "./dist/v2/node.d.mts",
      "./dist/v2/styles.css",
    ]);
    const stylesheet = fs.readFileSync(
      path.join(packageDir, "dist/v2/styles.css"),
      "utf8",
    );
    expect(stylesheet.replace(/\/\*[\s\S]*?\*\//g, "").trim()).toBe("");
  });

  const modes: {
    name: string;
    file: string;
    options: ts.CompilerOptions;
  }[] = [
    {
      name: "NodeNext, ESM",
      file: "consumer.mts",
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    },
    {
      name: "NodeNext, CommonJS",
      file: "consumer.cts",
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    },
    {
      name: "Bundler",
      file: "consumer.ts",
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
    },
    {
      name: "node10 (typesVersions)",
      file: "consumer.ts",
      options: {
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
      },
    },
  ];

  for (const { name, file, options } of modes) {
    it(`marks every name of the alias deprecated and keeps the root's types (${name})`, () => {
      const { root, packageDir } = setupBuiltProject();
      writeV2Aliases(packageDir);
      installExtra(root);

      expect(check(root, file, CONSUMER, options)).toEqual({
        errors: [],
        // `extra` was not in the list (its dependency was not built), so
        // it resolves through the trailing star export, untagged.
        deprecated: ["Client", "Options", "connect", "listen"],
      });
    });
  }

  it("fails when the package was not built", () => {
    const { packageDir } = setupProject({});

    expect(() => writeV2Aliases(packageDir)).toThrow("Build the package first");
  });

  it("fails when the package exports no /v2 alias", () => {
    const { packageDir } = setupBuiltProject();
    writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "fixture", exports: BUILT_EXPORTS }),
    );

    expect(() => writeV2Aliases(packageDir)).toThrow(
      'fixture exports no "./v2" aliases.',
    );
  });
});
