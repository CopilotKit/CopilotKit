import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const lockfile = readFileSync(
  resolve(process.cwd(), "../../pnpm-lock.yaml"),
  "utf8",
);

const sectionOf = (name: string) => {
  const section = lockfile.split(`\n${name}:\n`)[1];
  if (section === undefined) throw new Error(`missing ${name} section`);
  return section;
};

const blockFor = (section: string, entry: string) => {
  const lines = section.split("\n");
  const start = lines.indexOf(`  ${entry}:`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

describe("streamdown dependency graph", () => {
  it("resolves mermaid against the compatible parser release", () => {
    expect(lockfile).not.toContain("'@mermaid-js/parser@0.6.3':");
    expect(lockfile).not.toContain("mermaid@11.12.2:");

    const packages = sectionOf("packages");
    expect(blockFor(packages, "mermaid@11.12.3")).not.toBeNull();
    expect(blockFor(packages, "'@mermaid-js/parser@1.2.1'")).not.toBeNull();

    const snapshots = sectionOf("snapshots");
    expect(blockFor(snapshots, "'@mermaid-js/parser@1.2.1'")).not.toBeNull();
    expect(blockFor(snapshots, "mermaid@11.12.3")).toContain(
      "'@mermaid-js/parser': 1.2.1",
    );
  });
});
