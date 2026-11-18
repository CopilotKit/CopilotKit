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
function setupProject(
  dist: Record<string, string>,
  exports = v2AliasExports(BUILT_EXPORTS, ALIASES),
) {
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
          agent: ["./dist/agent.d.cts"],
          node: ["./dist/node.d.cts"],
          v2: ["./dist/v2/index.d.cts"],
          "v2/node": ["./dist/v2/node.d.cts"],
        },
      },
      exports,
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

/**
 * The `exports` that tsdown writes when each alias is an entry of the build:
 * a module of its own that adds 1.x names to its 2.0 entry.
 */
const MODULE_BUILT_EXPORTS = {
  ...BUILT_EXPORTS,
  "./agent": { import: "./dist/agent.mjs", require: "./dist/agent.cjs" },
  "./v2": { import: "./dist/v2/index.mjs", require: "./dist/v2/index.cjs" },
  "./v2/node": { import: "./dist/v2/node.mjs", require: "./dist/v2/node.cjs" },
};

const MODULE_ALIASES = {
  entries: { "./v2": ".", "./v2/node": "./node" },
  stylesheets: [],
};

/** The declaration file extension of each JavaScript extension. */
const TYPES = { mjs: "d.mts", cjs: "d.cts" } as const;

type AliasModuleDeclarations = (extension: keyof typeof TYPES) => string;

/**
 * The declarations that tsdown writes for the `./v2` module: one flat list of
 * the 2.0 names that it re-exports from the root and from `./agent`, and the
 * 1.x name `OldClient`, which is the root's `Client` under its old name.
 */
const v2ModuleDeclarations =
  (oldClientTag: string): AliasModuleDeclarations =>
  (extension) =>
    [
      `import { Client, Options, connect } from "../index.${extension}";`,
      `import { Agent } from "../agent.${extension}";`,
      'export * from "fixture-extra";',
      `${oldClientTag}declare const OldClient: typeof Client;`,
      `${oldClientTag}type OldClient = Client;`,
      "export { Agent, Client, OldClient, type Options, connect };",
    ].join("\n");

const OLD_CLIENT_TAG = '/** @deprecated Use `Client` from "fixture". */\n';

const nodeModuleDeclarations: AliasModuleDeclarations = (extension) =>
  [
    `import { listen } from "../node.${extension}";`,
    '/** @deprecated Use `listen` from "fixture/node". */',
    "declare const oldListen: typeof listen;",
    "export { listen, oldListen };",
  ].join("\n");

/** A built package whose `/v2` aliases have modules of their own. */
function setupModuleProject(
  v2Declarations = v2ModuleDeclarations(OLD_CLIENT_TAG),
) {
  const dist: Record<string, string> = {
    "index.mjs": "export {};",
    "index.cjs": "module.exports = {};",
    "agent.mjs": "export {};",
    "agent.cjs": "module.exports = {};",
    "node.mjs": "export {};",
    "node.cjs": "module.exports = {};",
    "v2/index.mjs": "export {};",
    "v2/index.cjs": "module.exports = {};",
    "v2/node.mjs": "export {};",
    "v2/node.cjs": "module.exports = {};",
  };
  for (const extension of ["mjs", "cjs"] as const) {
    const types = TYPES[extension];
    dist[`index.${types}`] = ROOT_DECLARATIONS;
    dist[`agent.${types}`] = "export declare class Agent { private secret; }";
    dist[`node.${types}`] = NODE_DECLARATIONS;
    dist[`v2/index.${types}`] = v2Declarations(extension);
    dist[`v2/node.${types}`] = nodeModuleDeclarations(extension);
  }
  return setupProject(
    dist,
    v2AliasExports(MODULE_BUILT_EXPORTS, MODULE_ALIASES),
  );
}

/** The tag that `writeV2Aliases` puts on a name that `alias` re-exports. */
function notice(alias: string, entry: string) {
  return `/** @deprecated "${alias}" is deprecated. Import from "${entry}". */`;
}

/** The comment before each name of the `export { ... }` lists of `text`. */
function exportTags(text: string) {
  const source = ts.createSourceFile(
    "alias.d.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const tags: Record<string, string> = {};
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      const comments = ts.getLeadingCommentRanges(text, element.pos) ?? [];
      tags[element.name.text] = comments
        .map(({ pos, end }) => text.slice(pos, end))
        .join("");
    }
  }
  return tags;
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
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (name) => ts.sys.fileExists(name),
    readFile: (name) => ts.sys.readFile(name),
    directoryExists: (name) => ts.sys.directoryExists(name),
    getDirectories: (name) => ts.sys.getDirectories(name),
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

  it("points an alias that the build exports at the files of its own module", () => {
    expect(v2AliasExports(MODULE_BUILT_EXPORTS, MODULE_ALIASES)).toEqual({
      ...MODULE_BUILT_EXPORTS,
      "./v2": {
        import: {
          types: "./dist/v2/index.d.mts",
          default: "./dist/v2/index.mjs",
        },
        require: {
          types: "./dist/v2/index.d.cts",
          default: "./dist/v2/index.cjs",
        },
      },
      "./v2/node": {
        import: {
          types: "./dist/v2/node.d.mts",
          default: "./dist/v2/node.mjs",
        },
        require: {
          types: "./dist/v2/node.d.cts",
          default: "./dist/v2/node.cjs",
        },
      },
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

  describe("for an alias with a module of its own", () => {
    const MODULE_CONSUMER = [
      'import { Agent, Client, OldClient, connect, extra, type Options } from "fixture/v2";',
      'import { listen, oldListen } from "fixture/v2/node";',
      'import { Client as RootClient } from "fixture";',
      "const fromRoot: RootClient = connect();",
      "const fromAlias: Client = fromRoot;",
      // The class has a private member, so this only compiles when the 1.x
      // name and the root name are the same class.
      "const fromOldName: RootClient = new OldClient();",
      "const oldType: OldClient = fromRoot;",
      "const options: Options = { url: '' };",
      "export const used = [fromAlias, fromOldName, oldType, Agent, extra, listen, oldListen, options];",
      "",
    ].join("\n");

    const readDeclarations = (packageDir: string) => {
      const read = (file: string) =>
        fs.readFileSync(path.join(packageDir, "dist/v2", file), "utf8");
      return {
        index: read("index.d.mts"),
        indexCjs: read("index.d.cts"),
        node: read("node.d.mts"),
        nodeCjs: read("node.d.cts"),
      };
    };

    for (const { name, file, options } of modes) {
      it(`marks every name deprecated and keeps the root's types (${name})`, () => {
        const { root, packageDir } = setupModuleProject();
        writeV2Aliases(packageDir);
        installExtra(root);

        expect(check(root, file, MODULE_CONSUMER, options)).toEqual({
          errors: [],
          // `extra` comes through the star export of an unbuilt dependency,
          // untagged, as for an alias without a module.
          deprecated: [
            "Agent",
            "Client",
            "OldClient",
            "Options",
            "connect",
            "listen",
            "oldListen",
          ],
        });
      });
    }

    it("names the 2.0 entry of each re-exported name, and leaves the 1.x names to their own tags", () => {
      const { packageDir } = setupModuleProject();

      expect(writeV2Aliases(packageDir).sort()).toEqual([
        "./dist/v2/index.d.cts",
        "./dist/v2/index.d.mts",
        "./dist/v2/node.d.cts",
        "./dist/v2/node.d.mts",
      ]);
      const { index, indexCjs, node, nodeCjs } = readDeclarations(packageDir);
      expect(exportTags(index)).toEqual({
        Agent: notice("fixture/v2", "fixture/agent"),
        Client: notice("fixture/v2", "fixture"),
        OldClient: "",
        Options: notice("fixture/v2", "fixture"),
        connect: notice("fixture/v2", "fixture"),
      });
      expect(exportTags(node)).toEqual({
        listen: notice("fixture/v2/node", "fixture/node"),
        oldListen: "",
      });
      expect(exportTags(indexCjs)).toEqual(exportTags(index));
      expect(exportTags(nodeCjs)).toEqual(exportTags(node));
    });

    it("gives the same declarations when it runs again", () => {
      const { packageDir } = setupModuleProject();
      writeV2Aliases(packageDir);
      const first = readDeclarations(packageDir);

      writeV2Aliases(packageDir);

      expect(readDeclarations(packageDir)).toEqual(first);
    });

    it("leaves a 1.x name to its own tag when a 2.0 entry exports another symbol with that name", () => {
      // The root also exports `connect`, but this alias declares its own.
      const { packageDir } = setupModuleProject((extension) =>
        [
          `import { Client } from "../index.${extension}";`,
          '/** @deprecated The 1.x connect. Use `connect` from "fixture". */',
          "declare function connect(): Client;",
          "export { Client, connect };",
        ].join("\n"),
      );
      writeV2Aliases(packageDir);

      const { index } = readDeclarations(packageDir);
      expect(exportTags(index)).toEqual({
        Client: notice("fixture/v2", "fixture"),
        connect: "",
      });
    });

    it("fails when a 1.x name has no @deprecated tag", () => {
      const { packageDir } = setupModuleProject(v2ModuleDeclarations(""));

      expect(() => writeV2Aliases(packageDir)).toThrow(
        "fixture/v2 exports OldClient, which no 2.0 entry exports.",
      );
    });
  });

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
