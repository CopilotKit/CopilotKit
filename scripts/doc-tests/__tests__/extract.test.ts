import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseMeta, extractFromMdx, writeExtractedBlocks } from "../extract";

// ---------------------------------------------------------------------------
// parseMeta
// ---------------------------------------------------------------------------

describe("parseMeta", () => {
  it("extracts key=value pairs from meta string", () => {
    const meta = 'title="main.py" doctest="server"';
    expect(parseMeta(meta)).toEqual({ title: "main.py", doctest: "server" });
  });

  it("handles single quotes", () => {
    const meta = "title='server.ts' doctest='component'";
    expect(parseMeta(meta)).toEqual({
      title: "server.ts",
      doctest: "component",
    });
  });

  it("returns empty object for empty meta", () => {
    expect(parseMeta("")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// extractFromMdx
// ---------------------------------------------------------------------------

describe("extractFromMdx", () => {
  it("extracts a doctest='server' block from simple MDX", () => {
    const mdx = `
# My Page

Some text.

\`\`\`python title="main.py" doctest="server"
import os
print("hello")
\`\`\`
`;

    const blocks = extractFromMdx(mdx, "/docs/test.mdx");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe("python");
    expect(blocks[0].title).toBe("main.py");
    expect(blocks[0].doctest).toBe("server");
    expect(blocks[0].code).toContain('print("hello")');
  });

  it("extracts multiple blocks from one file", () => {
    const mdx = `
\`\`\`python title="a.py" doctest="script"
print("a")
\`\`\`

\`\`\`typescript title="b.ts" doctest="component"
const x = 1;
\`\`\`
`;

    const blocks = extractFromMdx(mdx, "/docs/multi.mdx");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].doctest).toBe("script");
    expect(blocks[1].doctest).toBe("component");
  });

  it("ignores blocks without doctest attribute", () => {
    const mdx = `
\`\`\`python title="main.py"
print("no doctest")
\`\`\`

\`\`\`bash
echo "also no doctest"
\`\`\`

\`\`\`python title="tested.py" doctest="script"
print("has doctest")
\`\`\`
`;

    const blocks = extractFromMdx(mdx, "/docs/mixed.mdx");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("tested.py");
  });

  it("handles indented blocks inside JSX (Tab component)", () => {
    const mdx = `
import { Tab, Tabs } from "fumadocs-ui/components/tabs";

<Tabs items={["Python", "TypeScript"]}>
  <Tab value="Python">
    \`\`\`python title="main.py" doctest="server"
    import fastapi
    app = fastapi.FastAPI()
    \`\`\`
  </Tab>
</Tabs>
`;

    const blocks = extractFromMdx(mdx, "/docs/tabbed.mdx");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe("python");
    expect(blocks[0].doctest).toBe("server");
    expect(blocks[0].code).toContain("fastapi");
  });
});

// ---------------------------------------------------------------------------
// writeExtractedBlocks
// ---------------------------------------------------------------------------

describe("writeExtractedBlocks", () => {
  let tmpDir: string;
  let outputDir: string;
  let docsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctest-"));
    outputDir = path.join(tmpDir, "output");
    docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("groups blocks with the same title into one file", () => {
    const blocks = [
      {
        lang: "python",
        title: "main.py",
        doctest: "server",
        code: "# part 1",
        line: 10,
        sourceFile: path.join(docsDir, "guide.mdx"),
      },
      {
        lang: "python",
        title: "main.py",
        doctest: "server",
        code: "# part 2",
        line: 30,
        sourceFile: path.join(docsDir, "guide.mdx"),
      },
    ];

    const manifest = writeExtractedBlocks(blocks, outputDir, docsDir);

    expect(manifest).toHaveLength(1);
    expect(manifest[0].file).toBe("guide/main.py");

    const written = fs.readFileSync(
      path.join(outputDir, "guide", "main.py"),
      "utf-8",
    );
    expect(written).toContain("# part 1");
    expect(written).toContain("# part 2");
  });

  it("writes correct manifest.json structure", () => {
    const blocks = [
      {
        lang: "python",
        title: "server.py",
        doctest: "server",
        code: "print('hello')",
        line: 5,
        sourceFile: path.join(docsDir, "integrations", "test.mdx"),
      },
    ];

    // Create the nested dir so the relative path works
    fs.mkdirSync(path.join(docsDir, "integrations"), { recursive: true });

    const manifest = writeExtractedBlocks(blocks, outputDir, docsDir);

    expect(manifest).toHaveLength(1);
    expect(manifest[0].lang).toBe("python");
    expect(manifest[0].category).toBe("server");
    expect(manifest[0].source).toContain(":5");
    expect(manifest[0].id).toContain("integrations-test");
  });

  it("copies doctest.json sidecar when present", () => {
    const sidecar = { python: { deps: ["flask"] } };
    fs.writeFileSync(
      path.join(docsDir, "doctest.json"),
      JSON.stringify(sidecar),
    );

    const blocks = [
      {
        lang: "python",
        title: "app.py",
        doctest: "server",
        code: "from flask import Flask",
        line: 1,
        sourceFile: path.join(docsDir, "page.mdx"),
      },
    ];

    writeExtractedBlocks(blocks, outputDir, docsDir);

    const copied = JSON.parse(
      fs.readFileSync(path.join(outputDir, "page", "doctest.json"), "utf-8"),
    );
    expect(copied.python.deps).toContain("flask");
  });
});
