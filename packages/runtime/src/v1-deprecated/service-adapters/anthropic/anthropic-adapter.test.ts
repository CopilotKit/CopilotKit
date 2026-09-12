import { describe, expect, it } from "vitest";
import { FilterThinkingTextBuffer } from "./anthropic-adapter";

/**
 * Streams `chunks` through a fresh buffer the way the adapter does: only
 * non-empty returns are emitted, and the block is flushed at the end.
 */
function stream(chunks: string[], { flush = true } = {}): string {
  const buffer = new FilterThinkingTextBuffer();
  const emitted: string[] = [];
  for (const chunk of chunks) {
    const text = buffer.onTextChunk(chunk);
    if (text.length > 0) {
      emitted.push(text);
    }
  }
  if (flush) {
    const rest = buffer.flush();
    if (rest.length > 0) {
      emitted.push(rest);
    }
  }
  return emitted.join("");
}

describe("FilterThinkingTextBuffer", () => {
  it("strips a thinking block that opens the content block", () => {
    expect(stream(["<thinking>", "hidden", "</thinking>", "visible"])).toBe(
      "visible",
    );
    expect(stream(["<thi", "nking>plan</thinking>answer"])).toBe("answer");
    expect(stream(["<thinking>plan</thinking>", "answer"])).toBe("answer");
  });

  it("keeps everything held back when a chunk boundary falls inside a tag prefix", () => {
    // Before the fix only the diverging chunk came out: the buffered prefix
    // was dropped.
    expect(stream(["<", "b>bold</b> text"])).toBe("<b>bold</b> text");
    expect(stream(["<t", "able> rows"])).toBe("<table> rows");
    expect(stream(["<", "d", "i", "v", ">"])).toBe("<div>");
    expect(stream(["<", "5 is less than 10"])).toBe("<5 is less than 10");
  });

  it("only treats the start of the block as a tag", () => {
    expect(
      stream(["The tag is called ", "<thinking>", " and it hides text."]),
    ).toBe("The tag is called <thinking> and it hides text.");
    expect(stream(["if (a ", "< b) return;", "\n", "<"])).toBe(
      "if (a < b) return;\n<",
    );
  });

  it("releases a partial prefix when the block ends", () => {
    expect(stream(["<"])).toBe("<");
    expect(stream(["<thin"])).toBe("<thin");
    // Without the flush the trailing text was lost for good.
    expect(stream(["<"], { flush: false })).toBe("");
  });

  it("keeps an unterminated thinking block hidden", () => {
    expect(stream(["<thinking>", "never closed"])).toBe("");
  });

  it("passes ordinary text through untouched", () => {
    expect(stream(["Hello", " ", "world"])).toBe("Hello world");
    expect(stream(["Hello <thinking> world"])).toBe("Hello <thinking> world");
  });

  it("starts over after reset", () => {
    const buffer = new FilterThinkingTextBuffer();
    expect(buffer.onTextChunk("plain")).toBe("plain");
    buffer.reset();
    expect(buffer.onTextChunk("<thinking>x</thinking>y")).toBe("y");
    expect(buffer.flush()).toBe("");
  });
});
