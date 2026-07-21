import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

function readEntryPointExports(relativeEntryPoint: string): string[] {
  const entryPoint = resolve(process.cwd(), relativeEntryPoint);
  const program = ts.createProgram([entryPoint], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const sourceFile = program.getSourceFile(entryPoint);

  if (!sourceFile) {
    throw new Error(`Unable to load Angular entry point: ${entryPoint}`);
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) {
    throw new Error(`Unable to resolve Angular entry point: ${entryPoint}`);
  }

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName())
    .sort();
}

function readDocumentedExports(section: string): string[] {
  const apiReference = readFileSync(resolve(process.cwd(), "API.md"), "utf8");
  const sectionStart = `<!-- public-api:${section}:start -->`;
  const sectionEnd = `<!-- public-api:${section}:end -->`;
  const startIndex = apiReference.indexOf(sectionStart);
  const endIndex = apiReference.indexOf(sectionEnd);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`API.md is missing the ${section} public API section`);
  }

  return apiReference
    .slice(startIndex + sectionStart.length, endIndex)
    .split("\n")
    .flatMap((line) => {
      const match = /^- `([^`]+)`(?: — .+)?$/.exec(line.trim());
      return match?.[1] ? [match[1]] : [];
    })
    .sort();
}

test.each([
  ["root", "src/public-api.ts"],
  ["mcp-apps", "src/mcp-apps/index.ts"],
] as const)(
  "documents every %s entry-point export exactly once",
  (section, entryPoint) => {
    const documentedExports = readDocumentedExports(section);

    expect(new Set(documentedExports).size).toBe(documentedExports.length);
    expect(documentedExports).toEqual(readEntryPointExports(entryPoint));
  },
  15_000,
);

test("ships the README and exhaustive API contract in the package", () => {
  const packageConfiguration = JSON.parse(
    readFileSync(resolve(process.cwd(), "ng-package.json"), "utf8"),
  ) as { assets?: unknown };

  expect(packageConfiguration.assets).toEqual(["README.md", "API.md"]);
});
