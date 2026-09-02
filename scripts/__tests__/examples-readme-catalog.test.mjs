import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const examplesRoot = path.join(repoRoot, "examples");
const readme = fs.readFileSync(path.join(examplesRoot, "README.md"), "utf8");

const categories = [
  { directory: "integrations", heading: "Integrations" },
  { directory: "canvas", heading: "Canvas" },
  { directory: "showcases", heading: "Showcases" },
];

function currentExampleNames(category) {
  return fs
    .readdirSync(path.join(examplesRoot, category), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

function readmeCategory(category, heading) {
  const sectionPattern = new RegExp(
    `^## ${heading} \\((\\d+)\\)\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
    "m",
  );
  const section = readme.match(sectionPattern);
  assert.ok(section, `README is missing the ${heading} section and count`);

  const links = Array.from(
    section[2].matchAll(new RegExp(`\\(\\./${category}/([^/]+)/\\)`, "g")),
    (match) => match[1],
  ).sort();

  return { declaredCount: Number(section[1]), links };
}

for (const { directory, heading } of categories) {
  test(`${heading} count and links match the current example directories`, () => {
    const expectedNames = currentExampleNames(directory);
    const documented = readmeCategory(directory, heading);

    assert.equal(documented.declaredCount, expectedNames.length);
    assert.deepEqual(documented.links, expectedNames);
  });
}

test("catalog total matches all current example directories", () => {
  const expectedTotal = categories.reduce(
    (total, { directory }) => total + currentExampleNames(directory).length,
    0,
  );
  const totalMatch = readme.match(
    /contains (\d+) consolidated demo repositories/,
  );

  assert.ok(totalMatch, "README is missing the consolidated example total");
  assert.equal(Number(totalMatch[1]), expectedTotal);
});
