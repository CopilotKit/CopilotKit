/**
 * Shared renderers for the pinned Unicode full Default Case Folding tables.
 *
 * The TypeScript, Python, and C# SDKs each need the identical table so that a
 * path/collision key derived in one language is derived identically in the
 * other two. Keeping the three renderers in one module means a regeneration can
 * never refresh one language and leave the others behind.
 */

export const UNICODE_VERSION = "17.0.0";
export const SOURCE_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/CaseFolding.txt`;
export const SOURCE_SHA256 =
  "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183";
export const SOURCE_COPYRIGHT = "© 2025 Unicode®, Inc.";
export const SOURCE_TERMS_URL = "https://www.unicode.org/terms_of_use.html";
export const GENERATOR_COMMAND =
  "node scripts/generate-unicode-default-case-folding.mjs";

/** Relative output paths, in the order the generator writes them. */
export const OUTPUT_PATHS = Object.freeze({
  typescript: "packages/intelligence/src/unicode-default-case-folding-data.ts",
  python: "sdk-python/copilotkit/unicode_default_case_folding_data.py",
  csharp: "sdk-dotnet/CopilotKit.Intelligence/UnicodeDefaultCaseFoldingData.cs",
});

/** Parses the C and F records of a `CaseFolding.txt` payload. */
export function parseCaseFoldingSource(source) {
  const mappings = new Map();
  for (const line of source.split(/\r?\n/u)) {
    const [codePoint, status, mapping] = line
      .split("#", 1)[0]
      .split(";")
      .map((field) => field.trim());
    if (
      codePoint === undefined ||
      mapping === undefined ||
      (status !== "C" && status !== "F")
    ) {
      continue;
    }
    mappings.set(
      Number.parseInt(codePoint, 16),
      mapping
        .split(/\s+/u)
        .map((entry) => String.fromCodePoint(Number.parseInt(entry, 16)))
        .join(""),
    );
  }
  return mappings;
}

function provenanceLines(indent) {
  return [
    `Unicode ${UNICODE_VERSION} full Default Case Folding mappings.`,
    "",
    `Generated from ${SOURCE_URL}`,
    `Source SHA-256: ${SOURCE_SHA256}`,
    `Source copyright: ${SOURCE_COPYRIGHT}`,
    `Source terms and license: ${SOURCE_TERMS_URL}`,
    "Includes C and F records and excludes locale-specific Turkic T records.",
    "Do not edit by hand. Regenerate with:",
    GENERATOR_COMMAND,
  ].map((line) => (line === "" ? indent.trimEnd() : `${indent}${line}`));
}

/**
 * Escapes a mapping as an ASCII-only literal that is valid in both Python and
 * C#. Emitting escapes rather than raw code points keeps combining marks and
 * astral characters immune to source-file re-encoding or normalization.
 *
 * Escape hex digits are lowercase because `ruff format` — which the repository's
 * pre-commit hook runs over staged Python files — normalizes them that way. An
 * uppercase table would be rewritten on every commit and drift from its
 * TypeScript and C# peers.
 */
function asciiEscapedLiteral(mapping) {
  let literal = '"';
  for (const character of mapping) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint === 0x22 || codePoint === 0x5c) {
      literal += `\\${character}`;
    } else if (codePoint >= 0x20 && codePoint < 0x7f) {
      literal += character;
    } else if (codePoint > 0xffff) {
      literal += `\\U${codePoint.toString(16).padStart(8, "0")}`;
    } else {
      literal += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    }
  }
  return `${literal}"`;
}

export function renderTypeScriptModule(mappings) {
  const entries = [...mappings.entries()]
    .map(
      ([codePoint, mapping]) =>
        `    [0x${codePoint.toString(16)}, ${JSON.stringify(mapping)}],`,
    )
    .join("\n");
  return `/**
${provenanceLines(" * ").join("\n")}
 */
export const unicodeDefaultCaseFoldMappings: ReadonlyMap<number, string> =
  new Map([
${entries}
  ]);
`;
}

export function renderPythonModule(mappings) {
  const entries = [...mappings.entries()]
    .map(
      ([codePoint, mapping]) =>
        `        0x${codePoint.toString(16).toUpperCase()}: ${asciiEscapedLiteral(mapping)},`,
    )
    .join("\n");
  return `"""
${provenanceLines("").join("\n")}
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Mapping

UNICODE_DEFAULT_CASE_FOLD_MAPPINGS: Mapping[int, str] = MappingProxyType(
    {
${entries}
    }
)
`;
}

export function renderCSharpModule(mappings) {
  const entries = [...mappings.entries()]
    .map(
      ([codePoint, mapping]) =>
        `        { 0x${codePoint.toString(16).toUpperCase()}, ${asciiEscapedLiteral(mapping)} },`,
    )
    .join("\n");
  return `using System.Collections.Frozen;

namespace CopilotKit.Intelligence;

/// <summary>
${provenanceLines("/// ")
  .map((line) => (line.trimEnd() === "///" ? "///" : line))
  .join("\n")}
/// </summary>
internal static class UnicodeDefaultCaseFoldingData
{
    internal static readonly FrozenDictionary<int, string> Mappings = new Dictionary<int, string>
    {
${entries}
    }.ToFrozenDictionary();
}
`;
}
