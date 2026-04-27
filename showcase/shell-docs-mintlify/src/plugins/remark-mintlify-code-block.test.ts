import { describe, it, expect } from "vitest";
import {
  parseMeta,
  stripUnsupportedNotations,
  remarkMintlifyCodeBlock,
} from "./remark-mintlify-code-block";
import type { Root, Code } from "mdast";

describe("parseMeta", () => {
  it("returns defaults for empty meta", () => {
    expect(parseMeta("")).toEqual({
      lines: false,
      wrap: false,
      expandable: false,
    });
  });

  it("parses double-quoted title", () => {
    expect(parseMeta('title="page.tsx"')).toMatchObject({
      filename: "page.tsx",
    });
  });

  it("parses single-quoted title", () => {
    expect(parseMeta("title='component.tsx'")).toMatchObject({
      filename: "component.tsx",
    });
  });

  it("parses filename alias for title", () => {
    expect(parseMeta('filename="route.ts"')).toMatchObject({
      filename: "route.ts",
    });
  });

  it("parses titles with paths and parens", () => {
    expect(parseMeta('title="agent/.env (Azure OpenAI)"')).toMatchObject({
      filename: "agent/.env (Azure OpenAI)",
    });
  });

  it("parses lines/wrap/expandable boolean flags", () => {
    expect(parseMeta('title="x.ts" lines wrap')).toMatchObject({
      filename: "x.ts",
      lines: true,
      wrap: true,
      expandable: false,
    });
    expect(parseMeta("expandable")).toMatchObject({
      expandable: true,
    });
  });

  it("does not treat title as a flag", () => {
    expect(parseMeta('title="x"')).toMatchObject({
      lines: false,
      wrap: false,
      expandable: false,
    });
  });

  it("parses {1,3-5} highlight ranges into JSON-stringified array", () => {
    expect(parseMeta('title="x.ts" {1,3-5}')).toMatchObject({
      filename: "x.ts",
      highlight: "[1,3,4,5]",
    });
  });

  it("parses focus={1-3} ranges", () => {
    expect(parseMeta("focus={1-3}")).toMatchObject({
      focus: "[1,2,3]",
    });
  });

  it("parses icon attribute", () => {
    expect(parseMeta('icon="terminal"')).toMatchObject({
      icon: "terminal",
    });
  });
});

describe("stripUnsupportedNotations", () => {
  it("strips standalone `// [!code word:foo]` lines", () => {
    const input = `import x from 'y';\n// [!code word:foo]\nconsole.log(x);`;
    const out = stripUnsupportedNotations(input);
    expect(out).not.toContain("[!code word:");
    expect(out).toContain("import x from 'y';");
    expect(out).toContain("console.log(x);");
  });

  it("strips inline `// [!code word:foo]` from end of line", () => {
    const input = `const x = 1; // [!code word:x]`;
    const out = stripUnsupportedNotations(input);
    expect(out).not.toContain("[!code word:");
    expect(out).toContain("const x = 1;");
  });

  it("leaves supported notations untouched", () => {
    const input = `const x = 1; // [!code highlight]\n// [!code focus]`;
    expect(stripUnsupportedNotations(input)).toBe(input);
  });

  it("handles `# [!code word:foo]` for shell/python", () => {
    const input = `echo hi\n# [!code word:hi]\necho bye`;
    const out = stripUnsupportedNotations(input);
    expect(out).not.toContain("[!code word:");
    expect(out).toContain("echo hi");
    expect(out).toContain("echo bye");
  });
});

describe("remarkMintlifyCodeBlock", () => {
  it("rewrites a code node with lang into an mdxJsxFlowElement", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "code",
          lang: "tsx",
          meta: 'title="page.tsx"',
          value: "const x = 1;",
        } as Code,
      ],
    };
    // @ts-expect-error - simplified Plugin interface for testing
    remarkMintlifyCodeBlock()(tree);

    expect(tree.children).toHaveLength(1);
    const replaced = tree.children[0] as unknown as {
      type: string;
      name: string;
      attributes: Array<{ name: string; value: string | null }>;
      children: unknown[];
    };
    expect(replaced.type).toBe("mdxJsxFlowElement");
    expect(replaced.name).toBe("MintCodeBlock");
    expect(replaced.children).toEqual([]);
    const attrMap = Object.fromEntries(
      replaced.attributes.map((a) => [a.name, a.value]),
    );
    expect(attrMap.language).toBe("tsx");
    expect(attrMap.filename).toBe("page.tsx");
    expect(attrMap.code).toBe("const x = 1;");
  });

  it("skips code nodes without a language hint", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "code",
          lang: null,
          meta: null,
          value: "plain text fence",
        } as Code,
      ],
    };
    // @ts-expect-error - simplified Plugin interface for testing
    remarkMintlifyCodeBlock()(tree);
    expect(tree.children[0].type).toBe("code");
  });

  it("strips `[!code word:foo]` notation from rewritten source", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "code",
          lang: "tsx",
          meta: "",
          value: "// [!code word:foo]\nconst x = 1;",
        } as Code,
      ],
    };
    // @ts-expect-error - simplified Plugin interface for testing
    remarkMintlifyCodeBlock()(tree);
    const replaced = tree.children[0] as unknown as {
      attributes: Array<{ name: string; value: string }>;
    };
    const codeAttr = replaced.attributes.find((a) => a.name === "code");
    expect(codeAttr?.value).not.toContain("[!code word:");
    expect(codeAttr?.value).toContain("const x = 1;");
  });
});
