import { describe, it, expect } from "vitest";
import { applyDocSwaps } from "./doc-swap";

describe("applyDocSwaps", () => {
  it("is a no-op for content without markers", () => {
    const src = `import { ChatOpenAI } from "@langchain/openai";\nconst model = new ChatOpenAI({ model: "gpt-5.4" });\n`;
    expect(applyDocSwaps(src)).toBe(src);
  });

  it("swaps the replace body for the uncommented as body", () => {
    const src = [
      "// @doc-replace",
      'const model = makeChatOpenAI(config, { model: "gpt-5.4" });',
      "// @doc-as",
      '// const model = new ChatOpenAI({ model: "gpt-5.4" });',
      "// @doc-end",
    ].join("\n");
    expect(applyDocSwaps(src)).toBe(
      'const model = new ChatOpenAI({ model: "gpt-5.4" });',
    );
  });

  it("omits the replace body when the as body is empty (drop an import)", () => {
    const src = [
      'import { ChatOpenAI } from "@langchain/openai";',
      "// @doc-replace",
      'import { makeChatOpenAI } from "./openai-headers";',
      "// @doc-as",
      "// @doc-end",
      "const model = makeChatOpenAI(config, {});",
    ].join("\n");
    // The helper import line is gone; everything else (including the marker
    // lines) is stripped, leaving the surrounding real code intact.
    expect(applyDocSwaps(src)).toBe(
      [
        'import { ChatOpenAI } from "@langchain/openai";',
        "const model = makeChatOpenAI(config, {});",
      ].join("\n"),
    );
  });

  it("preserves indentation across multi-line swaps", () => {
    const src = [
      "  // @doc-replace",
      "  const model = makeChatOpenAI(config, {",
      '    model: "gpt-5.4",',
      "  });",
      "  // @doc-as",
      "  // const model = new ChatOpenAI({",
      '  //   model: "gpt-5.4",',
      "  // });",
      "  // @doc-end",
    ].join("\n");
    expect(applyDocSwaps(src)).toBe(
      [
        "  const model = new ChatOpenAI({",
        '    model: "gpt-5.4",',
        "  });",
      ].join("\n"),
    );
  });

  it("supports `#` comment style (Python)", () => {
    const src = [
      "# @doc-replace",
      "model = make_chat_openai(config, model='gpt-5.4')",
      "# @doc-as",
      "# model = ChatOpenAI(model='gpt-5.4')",
      "# @doc-end",
    ].join("\n");
    expect(applyDocSwaps(src)).toBe("model = ChatOpenAI(model='gpt-5.4')");
  });

  it("handles multiple independent swap blocks in one file", () => {
    const src = [
      "// @doc-replace",
      'import { makeChatOpenAI } from "./openai-headers";',
      "// @doc-as",
      '// import { ChatOpenAI } from "@langchain/openai";',
      "// @doc-end",
      "const x = 1;",
      "// @doc-replace",
      "const m = makeChatOpenAI(config, {});",
      "// @doc-as",
      "// const m = new ChatOpenAI({});",
      "// @doc-end",
    ].join("\n");
    expect(applyDocSwaps(src)).toBe(
      [
        'import { ChatOpenAI } from "@langchain/openai";',
        "const x = 1;",
        "const m = new ChatOpenAI({});",
      ].join("\n"),
    );
  });

  it("leaves surrounding lines untouched", () => {
    const src = [
      "line before",
      "// @doc-replace",
      "harness();",
      "// @doc-as",
      "// real();",
      "// @doc-end",
      "line after",
    ].join("\n");
    expect(applyDocSwaps(src)).toBe(
      ["line before", "real();", "line after"].join("\n"),
    );
  });

  it("throws on @doc-replace without @doc-as", () => {
    const src = ["// @doc-replace", "harness();"].join("\n");
    expect(() => applyDocSwaps(src, "f.ts")).toThrow(/matching @doc-as/);
  });

  it("throws on @doc-as without @doc-end", () => {
    const src = [
      "// @doc-replace",
      "harness();",
      "// @doc-as",
      "// real();",
    ].join("\n");
    expect(() => applyDocSwaps(src, "f.ts")).toThrow(/matching @doc-end/);
  });

  it("throws on a stray @doc-as with no @doc-replace", () => {
    const src = ["// @doc-as", "// real();", "// @doc-end"].join("\n");
    expect(() => applyDocSwaps(src, "f.ts")).toThrow(/stray/);
  });

  it("throws on a stray @doc-end", () => {
    expect(() => applyDocSwaps("// @doc-end", "f.ts")).toThrow(/stray/);
  });
});
