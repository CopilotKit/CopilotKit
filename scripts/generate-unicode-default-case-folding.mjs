import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const UNICODE_VERSION = "17.0.0";
const SOURCE_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/CaseFolding.txt`;
const SOURCE_SHA256 =
  "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183";
const SOURCE_COPYRIGHT = "© 2025 Unicode®, Inc.";
const SOURCE_TERMS_URL = "https://www.unicode.org/terms_of_use.html";
const OUTPUT_URL = new URL(
  "../packages/intelligence/src/unicode-default-case-folding-data.ts",
  import.meta.url,
);

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(
    `Could not download Unicode case-folding data: ${response.status} ${response.statusText}`,
  );
}
const source = await response.text();
const sourceSha256 = createHash("sha256").update(source).digest("hex");
if (sourceSha256 !== SOURCE_SHA256) {
  throw new Error(
    `Unicode case-folding data has SHA-256 ${sourceSha256}; expected ${SOURCE_SHA256}`,
  );
}

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

const entries = [...mappings.entries()]
  .map(
    ([codePoint, mapping]) =>
      `    [0x${codePoint.toString(16)}, ${JSON.stringify(mapping)}],`,
  )
  .join("\n");
const output = `/**
 * Unicode ${UNICODE_VERSION} full Default Case Folding mappings.
 *
 * Generated from ${SOURCE_URL}
 * Source SHA-256: ${SOURCE_SHA256}
 * Source copyright: ${SOURCE_COPYRIGHT}
 * Source terms and license: ${SOURCE_TERMS_URL}
 * Includes C and F records and excludes locale-specific Turkic T records.
 * Do not edit by hand. Regenerate with:
 * node scripts/generate-unicode-default-case-folding.mjs
 */
export const unicodeDefaultCaseFoldMappings: ReadonlyMap<number, string> =
  new Map([
${entries}
  ]);
`;

await writeFile(OUTPUT_URL, output, "utf8");
