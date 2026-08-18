import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface ManifestPackage {
  name: string;
  version: string;
  sourceDirectory: string;
  entrypoints: Array<{ importPath: string }>;
}

interface PublicApiManifest {
  packages: ManifestPackage[];
  deprecations: Array<{
    importPath: string;
    symbol: string;
    replacement: { importPath: string; symbol: string };
  }>;
}

const manifest = JSON.parse(
  readFileSync(
    resolve(root, "scripts/release/public-api/manifest.v1.json"),
    "utf8",
  ),
) as PublicApiManifest;

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function libraryVersion(skill: string): string | undefined {
  return skill.match(/^library_version:\s*["']?([^"'\n]+)["']?$/m)?.[1];
}

function filesUnder(relativeDirectory: string): string[] {
  const absoluteDirectory = resolve(root, relativeDirectory);

  function walk(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
  }

  return walk(absoluteDirectory);
}

const setupAssets = [
  "skills/copilotkit-setup/assets/nextjs-app-router-route.ts",
  "skills/copilotkit-setup/assets/nextjs-app-router-page.tsx",
  "skills/copilotkit-setup/assets/express-runtime.ts",
];

function copilotImports(relativePath: string) {
  const source = read(relativePath);
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return sourceFile.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith("@copilotkit/")
    ) {
      return [];
    }

    const symbols = statement.importClause?.namedBindings;
    return [
      {
        importPath: statement.moduleSpecifier.text,
        symbols:
          symbols && ts.isNamedImports(symbols)
            ? symbols.elements.map(
                (element) => element.propertyName?.text ?? element.name.text,
              )
            : [],
      },
    ];
  });
}

describe("public skill drift", () => {
  it("keeps setup assets compatible with current public package contracts", () => {
    const contractErrors = setupAssets.flatMap((asset) =>
      copilotImports(asset).flatMap(({ importPath, symbols }) => {
        const packageName = importPath.split("/").slice(0, 2).join("/");
        const packageEntry = manifest.packages.find(
          (candidate) => candidate.name === packageName,
        );
        if (!packageEntry) {
          return [`${asset}: ${packageName} is not a published package`];
        }
        if (
          !packageEntry.entrypoints.some(
            (entrypoint) => entrypoint.importPath === importPath,
          )
        ) {
          return [`${asset}: ${importPath} is not a published entrypoint`];
        }

        return symbols.flatMap((symbol) => {
          const deprecation = manifest.deprecations.find(
            (candidate) =>
              candidate.importPath === importPath &&
              candidate.symbol === symbol,
          );
          return deprecation
            ? [
                `${asset}: ${symbol} is deprecated; use ${deprecation.replacement.symbol} from ${deprecation.replacement.importPath}`,
              ]
            : [];
        });
      }),
    );

    expect(contractErrors).toEqual([]);
  });

  it.each([
    ["@copilotkit/runtime", "runtime"],
    ["@copilotkit/react-core", "react-core"],
    ["@copilotkit/a2ui-renderer", "a2ui-renderer"],
  ])(
    "%s skill version follows the public API manifest",
    (packageName, skillName) => {
      const packageEntry = manifest.packages.find(
        (candidate) => candidate.name === packageName,
      );
      expect(
        packageEntry,
        `${packageName} missing from manifest`,
      ).toBeDefined();

      const sourceSkill = read(
        `${packageEntry!.sourceDirectory}/skills/${skillName}/SKILL.md`,
      );
      const mirrorSkill = read(`skills/${skillName}/SKILL.md`);

      expect(libraryVersion(sourceSkill)).toBe(packageEntry!.version);
      expect(libraryVersion(mirrorSkill)).toBe(packageEntry!.version);
    },
  );

  it("keeps current setup and debugging paths free of retired API forms", () => {
    const currentFiles = [
      resolve(root, "skills/copilotkit-setup/eval.yaml"),
      ...filesUnder("skills/copilotkit-debug"),
    ];
    const retiredForms = [
      /@copilotkit\/react(?!-)/,
      /@copilotkit\/agent(?![a-z-])/,
      /\bcreateCopilotEndpoint(?:SingleRoute(?:Express)?|Express)?\b/,
      /packages\/v[12]\//,
    ];

    const findings = currentFiles.flatMap((file) => {
      const relativeFile = file.slice(root.length + 1);
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          retiredForms.some((pattern) => pattern.test(line))
            ? [`${relativeFile}:${index + 1}: ${line.trim()}`]
            : [],
        );
    });

    expect(findings).toEqual([]);
  });

  it("grades the stylesheet through its exact public entrypoint", () => {
    const reactCore = manifest.packages.find(
      (candidate) => candidate.name === "@copilotkit/react-core",
    );
    const stylesheet = "@copilotkit/react-core/v2/styles.css";
    const setupEval = read("skills/copilotkit-setup/eval.yaml");

    expect(
      reactCore?.entrypoints.some(
        (entrypoint) => entrypoint.importPath === stylesheet,
      ),
    ).toBe(true);
    expect(setupEval).toContain(`grep -rF "${stylesheet}"`);
    expect(setupEval).not.toContain(
      'grep -r "styles\\.css\\|@copilotkit/react/styles"',
    );
  });

  it("keeps debugging source inventory paths resolvable", () => {
    const paths = read("skills/copilotkit-debug/sources.md")
      .split("\n")
      .flatMap(
        (line) => line.match(/^- (packages\/\S+?)(?:\/)? \(/)?.[1] ?? [],
      );

    expect(paths.length).toBeGreaterThan(0);
    expect(
      paths.filter((relativePath) => !existsSync(resolve(root, relativePath))),
    ).toEqual([]);
  });
});
