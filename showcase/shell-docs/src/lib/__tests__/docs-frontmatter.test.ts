import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTENT_DIR, loadDoc } from "../docs-render";

let fixtureDir = "";

afterEach(() => {
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
  fixtureDir = "";
});

function writeDoc(frontmatter: string): string {
  fixtureDir = fs.mkdtempSync(path.join(CONTENT_DIR, "__vue-docs-fm-"));
  fs.writeFileSync(
    path.join(fixtureDir, "index.mdx"),
    `---\ntitle: Fixture\n${frontmatter}\n---\n\nFixture body\n`,
  );
  return path.basename(fixtureDir);
}

describe("Vue docs frontmatter", () => {
  it("exposes vue_docs as vueDocs", () => {
    const slug = writeDoc("vue_docs: not-applicable");

    expect(loadDoc(slug)?.fm.vueDocs).toBe("not-applicable");
  });

  it("preserves unknown string values for projection diagnostics", () => {
    const slug = writeDoc("vue_docs: future-value");

    expect(loadDoc(slug)?.fm.vueDocs).toBe("future-value");
  });

  it("ignores non-string values", () => {
    const slug = writeDoc("vue_docs:\n  disposition: shared");

    expect(loadDoc(slug)?.fm.vueDocs).toBeUndefined();
  });
});
