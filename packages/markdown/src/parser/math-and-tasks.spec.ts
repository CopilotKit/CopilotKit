import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from "./index";
import type { StreamingMarkdownParserOptions } from "./index";

function parse(
  input: string,
  options: Partial<StreamingMarkdownParserOptions> = {},
) {
  const state = createStreamingMarkdownParserState({
    segmenter: false,
    ...options,
  });
  return finalizeStreamingMarkdown(parseStreamingMarkdownChunk(state, input));
}

function mathNodes(input: string) {
  return parse(input, { enableMath: true })
    .nodes.filter((node) => node.type === "math")
    .map((node) => (node.type === "math" ? [node.text, node.display] : []));
}

function plainText(input: string, options: { enableMath: boolean }) {
  return parse(input, options)
    .nodes.map((node) => (node.type === "text" ? node.text : ""))
    .join("");
}

describe("math", () => {
  test("is plain text unless enableMath is set", () => {
    const input = "Euler: $e^{i\\pi}$";
    expect(plainText(input, { enableMath: false })).toBe(input);
    expect(mathNodes(input)).toEqual([["e^{i\\pi}", false]]);
  });

  test("parses inline and multi-line display math", () => {
    expect(mathNodes("a $x^2$ b $$\\frac{a}{b}$$\n\n$$\ny = 2\n$$")).toEqual([
      ["x^2", false],
      ["\\frac{a}{b}", true],
      ["\ny = 2\n", true],
    ]);
  });

  test("keeps currency ranges as prose", () => {
    const input = "United at $349 (departing 08:00) and Delta at $289.";
    expect(mathNodes(input)).toEqual([]);
    expect(plainText(input, { enableMath: true })).toBe(input);
  });

  test("does not parse math inside inline code or after an escaped dollar", () => {
    expect(mathNodes("`echo $PATH$` and \\$5$")).toEqual([]);
  });

  test("leaves an unclosed delimiter as text while streaming", () => {
    const state = createStreamingMarkdownParserState({
      segmenter: false,
      enableMath: true,
    });
    const partial = parseStreamingMarkdownChunk(state, "sum $x + ");
    expect(partial.nodes.some((node) => node.type === "math")).toBe(false);

    const done = parseStreamingMarkdownChunk(partial, "y$ end");
    const math = done.nodes.find((node) => node.type === "math");
    expect(math?.type === "math" ? math.text : null).toBe("x + y");
  });
});

describe("task lists", () => {
  test("marks checked and unchecked items and strips the marker", () => {
    const result = parse("- [x] done\n- [ ] todo\n- plain");
    const items = result.nodes.flatMap((node) =>
      node.type === "list-item" ? [node.checked] : [],
    );
    expect(items).toEqual([true, false, undefined]);
    const texts = result.nodes.flatMap((node) =>
      node.type === "text" ? [node.text] : [],
    );
    expect(texts).toEqual(["done", "todo", "plain"]);
  });

  test("needs content after the marker", () => {
    const result = parse("- [x]");
    const item = result.nodes.find((node) => node.type === "list-item");
    expect(item?.type === "list-item" ? item.checked : "missing").toBe(
      undefined,
    );
  });
});
