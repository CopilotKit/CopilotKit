import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unicodeDefaultCaseFold } from "./unicode-default-case-folding.js";
import { unicodeDefaultCaseFoldMappings } from "./unicode-default-case-folding-data.js";

/**
 * The TypeScript, Python, and C# SDKs each derive path/collision keys from a
 * pinned copy of the same Unicode table. `scripts/generate-unicode-default-case-folding.mjs`
 * emits all three from one source, and this suite is the gate that keeps a
 * hand-edit or a partial regeneration from letting one language drift.
 */
const PYTHON_TABLE = fileURLToPath(
  new URL(
    "../../../sdk-python/copilotkit/unicode_default_case_folding_data.py",
    import.meta.url,
  ),
);
const CSHARP_TABLE = fileURLToPath(
  new URL(
    "../../../sdk-dotnet/CopilotKit.Intelligence/UnicodeDefaultCaseFoldingData.cs",
    import.meta.url,
  ),
);

function decodeAsciiEscapedLiteral(literal: string): string {
  return literal.replace(
    /\\U([0-9A-Fa-f]{8})|\\u([0-9A-Fa-f]{4})|\\(["\\])/gu,
    (_match, astral: string | undefined, bmp: string | undefined, raw) =>
      astral !== undefined
        ? String.fromCodePoint(Number.parseInt(astral, 16))
        : bmp !== undefined
          ? String.fromCodePoint(Number.parseInt(bmp, 16))
          : (raw as string),
  );
}

function parseGeneratedTable(
  path: string,
  pattern: RegExp,
): ReadonlyMap<number, string> {
  const mappings = new Map<number, string>();
  for (const match of readFileSync(path, "utf8").matchAll(pattern)) {
    mappings.set(
      Number.parseInt(match[1]!, 16),
      decodeAsciiEscapedLiteral(match[2]!),
    );
  }
  return mappings;
}

describe("Unicode Default Case Folding", () => {
  it("publishes the same pinned table to TypeScript, Python, and C#", () => {
    const python = parseGeneratedTable(
      PYTHON_TABLE,
      /^ {8}0x([0-9A-F]+): "((?:[^"\\]|\\.)*)",$/gmu,
    );
    const csharp = parseGeneratedTable(
      CSHARP_TABLE,
      /^ {8}\{ 0x([0-9A-F]+), "((?:[^"\\]|\\.)*)" \},$/gmu,
    );

    expect(unicodeDefaultCaseFoldMappings.size).toBeGreaterThan(1_000);
    expect(python.size).toBe(unicodeDefaultCaseFoldMappings.size);
    expect(csharp.size).toBe(unicodeDefaultCaseFoldMappings.size);
    for (const [codePoint, mapping] of unicodeDefaultCaseFoldMappings) {
      expect(python.get(codePoint), `python 0x${codePoint.toString(16)}`).toBe(
        mapping,
      );
      expect(csharp.get(codePoint), `csharp 0x${codePoint.toString(16)}`).toBe(
        mapping,
      );
    }
  });

  it("pins the same Unicode source revision in all three generated files", () => {
    const sourceSha256 =
      "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183";
    for (const path of [PYTHON_TABLE, CSHARP_TABLE]) {
      const contents = readFileSync(path, "utf8");
      expect(contents).toContain(sourceSha256);
      expect(contents).toContain(
        "node scripts/generate-unicode-default-case-folding.mjs",
      );
    }
  });

  it("collapses the collision pairs the conformance corpus declares invalid", () => {
    for (const [left, right] of [
      ["Straße.txt", "STRASSE.txt"],
      ["İ.txt", "i̇.txt"],
      ["ﬁle.md", "file.md"],
      ["SKILL.md", "skill.md"],
      ["ΣΊΣΥΦΟΣ.md", "Σίσυφος.md"],
    ]) {
      expect(
        unicodeDefaultCaseFold(left!.normalize("NFC")),
        `${left} vs ${right}`,
      ).toBe(unicodeDefaultCaseFold(right!.normalize("NFC")));
    }
  });

  it("excludes locale-specific Turkic mappings", () => {
    expect(unicodeDefaultCaseFold("ı")).toBe("ı");
    expect(unicodeDefaultCaseFold("I")).toBe("i");
    expect(unicodeDefaultCaseFold("ı")).not.toBe(unicodeDefaultCaseFold("I"));
  });
});
