import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from "./index";
import type { StreamingMarkdownAstNode } from "./index";

function parseAll(input: string) {
  const state = createStreamingMarkdownParserState();

  return parseStreamingMarkdownChunk(state, input);
}

test("creates default parser state", () => {
  const state = createStreamingMarkdownParserState();

  expect(state.rootId).toBe(1);
  expect(state.nodes).toHaveLength(1);
  expect(state.nodes[0].type).toBe("document");
  expect(state.mode).toBe("block");
  expect(state.isComplete).toBe(false);
});

test("parses streamed heading paragraph and list blocks", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const a = parseStreamingMarkdownChunk(state, "# Hello\n\nPara");
  const b = parseStreamingMarkdownChunk(a, "graph\n\n- one\n- two\n");

  expect(b.nodes.some((node) => node.type === "heading")).toBe(true);
  expect(b.nodes.some((node) => node.type === "paragraph")).toBe(true);
  expect(b.nodes.some((node) => node.type === "list")).toBe(true);
  expect(b.warnings).toEqual([]);
});

test("parses atx and setext headings", () => {
  const result = parseAll("# One\n\nTwo\n---\n");

  const headings = result.nodes.filter((node) => node.type === "heading");

  expect(headings).toHaveLength(2);
  expect(headings[0].type === "heading" ? headings[0].level : 0).toBe(1);
  expect(headings[1].type === "heading" ? headings[1].level : 0).toBe(2);
});

test("parses thematic break", () => {
  const result = parseAll("before\n\n---\n\nafter\n");

  expect(result.nodes.some((node) => node.type === "thematic-break")).toBe(
    true,
  );
});

test("parses ordered and unordered lists with metadata", () => {
  const result = parseAll("3. three\n4. four\n\n- one\n- two\n");

  const lists = result.nodes.filter((node) => node.type === "list");

  expect(lists).toHaveLength(2);
  expect(lists[0].type === "list" ? lists[0].ordered : false).toBe(true);
  expect(lists[0].type === "list" ? lists[0].start : null).toBe(3);
  expect(lists[1].type === "list" ? lists[1].ordered : true).toBe(false);
});

test("parses loose list when blank lines appear between items", () => {
  const result = parseAll("- first\n\n- second\n");

  const list = result.nodes.find((node) => node.type === "list");

  expect(list).toBeDefined();
  expect(list && list.type === "list" ? list.tight : true).toBe(false);
});

test("parses blockquote with lazy continuation", () => {
  const result = parseAll("> alpha\nlazy line\n> omega\n");

  const quote = result.nodes.find((node) => node.type === "blockquote");

  expect(quote).toBeDefined();
  expect(result.nodes.some((node) => node.type === "paragraph")).toBe(true);
});

test("parses fenced code block and closes when finalized", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const partial = parseStreamingMarkdownChunk(state, "```ts\nconst x = 1;");
  const open = partial.nodes.find((node) => node.type === "code-block");

  const final = finalizeStreamingMarkdown(partial);
  const closed = final.nodes.find((node) => node.type === "code-block");

  expect(open).toBeDefined();
  expect(open?.closed).toBe(false);
  expect(closed?.closed).toBe(true);
  expect(final.isComplete).toBe(true);
});

test("parses table rows and alignment when enabled", () => {
  const state = createStreamingMarkdownParserState({
    enableTables: true,
    segmenter: false,
  });

  const result = parseStreamingMarkdownChunk(
    state,
    "| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |",
  );

  const table = result.nodes.find((node) => node.type === "table");
  const rows = result.nodes.filter((node) => node.type === "table-row");

  expect(table).toBeDefined();
  expect(table && table.type === "table" ? table.align : []).toEqual([
    "left",
    "right",
  ]);
  expect(rows).toHaveLength(3);
});

test("does not create table node when tables are disabled", () => {
  const state = createStreamingMarkdownParserState({
    enableTables: false,
    segmenter: false,
  });

  const result = parseStreamingMarkdownChunk(
    state,
    "| A | B |\n| --- | --- |\n| 1 | 2 |",
  );

  expect(result.nodes.some((node) => node.type === "table")).toBe(false);
});

test("parses links and images with optional title", () => {
  const result = parseAll(
    '[site](https://example.org "Example") ![logo](https://x.test/logo.png)',
  );

  const link = result.nodes.find((node) => node.type === "link");
  const image = result.nodes.find((node) => node.type === "image");

  expect(link).toBeDefined();
  expect(link && link.type === "link" ? link.url : "").toBe(
    "https://example.org",
  );
  expect(link && link.type === "link" ? link.title : "").toBe("Example");
  expect(image).toBeDefined();
  expect(image && image.type === "image" ? image.alt : "").toBe("logo");
});

test("parses angle and bare autolinks when enabled", () => {
  const result = parseAll("<https://a.test> www.b.test foo@bar.test");

  const autolinks = result.nodes.filter((node) => node.type === "autolink");

  expect(autolinks).toHaveLength(3);
});

test("does not parse autolinks when disabled", () => {
  const state = createStreamingMarkdownParserState({ enableAutolinks: false });

  const result = parseStreamingMarkdownChunk(
    state,
    "<https://a.test> www.b.test foo@bar.test",
  );

  expect(result.nodes.some((node) => node.type === "autolink")).toBe(false);
});

test("parses emphasis strong strikethrough and inline code", () => {
  const result = parseAll("*em* **strong** ~~del~~ `code`");

  expect(result.nodes.some((node) => node.type === "em")).toBe(true);
  expect(result.nodes.some((node) => node.type === "strong")).toBe(true);
  expect(result.nodes.some((node) => node.type === "strikethrough")).toBe(true);
  expect(result.nodes.some((node) => node.type === "inline-code")).toBe(true);
});

test("creates citation nodes and numbers by first reference", () => {
  const result = parseAll(
    "[^b] then [^a]\n\n[^a]: Alpha https://a.test\n[^b]: Beta",
  );

  const citations = result.nodes.filter((node) => node.type === "citation");

  expect(citations).toHaveLength(2);
  expect(result.citations.order).toEqual(["b", "a"]);
  expect(result.citations.numbers).toEqual({ b: 1, a: 2 });
  expect(result.citations.definitions["a"]).toEqual({
    id: "a",
    text: "Alpha",
    url: "https://a.test",
  });
  expect(result.citations.definitions["b"]).toEqual({
    id: "b",
    text: "Beta",
  });
});

test("marks punctuation segments after citations as no-break-before", () => {
  const result = parseAll("Alpha[^a]; beta\n\n[^a]: Source");
  const textNodes = result.nodes.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const punctuationNode = textNodes.find((node) => node.text.startsWith(";"));
  const firstSegment = punctuationNode?.segments[0];

  expect(punctuationNode).toBeDefined();
  expect(firstSegment?.text.startsWith(";")).toBe(true);
  expect(firstSegment?.noBreakBefore).toBe(true);
});

test("marks CJK punctuation segments after citations as no-break-before", () => {
  const result = parseAll("你好[^a]。世界\n\n[^a]: Source");
  const textNodes = result.nodes.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const punctuationNode = textNodes.find((node) => node.text.startsWith("。"));
  const firstSegment = punctuationNode?.segments[0];

  expect(punctuationNode).toBeDefined();
  expect(firstSegment?.text.startsWith("。")).toBe(true);
  expect(firstSegment?.noBreakBefore).toBe(true);
});

test("warns on duplicate citation definitions", () => {
  const result = parseAll("[^a]: one\n[^a]: two");

  expect(
    result.warnings.some(
      (warning) => warning.code === "invalid_citation_definition",
    ),
  ).toBe(true);
});

test("optimistically hides unfinished citation-definition prefixes while streaming", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(state, "Paragraph\n[^source");
  const textNodes = next.nodes.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const renderedText = textNodes.map((node) => node.text).join("");

  expect(renderedText).toContain("Paragraph");
  expect(renderedText).not.toContain("[^source");
});

test("renders unfinished citation-definition prefix as text once it becomes invalid", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const partial = parseStreamingMarkdownChunk(state, "Paragraph\n[^source");
  const next = parseStreamingMarkdownChunk(partial, " invalid\n");
  const textNodes = next.nodes.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const renderedText = textNodes.map((node) => node.text).join("");

  expect(renderedText).toContain("Paragraph");
  expect(renderedText).toContain("[^source invalid");
});

test("keeps citation-definition prefix hidden when it resolves into a valid definition", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const partial = parseStreamingMarkdownChunk(state, "Paragraph\n[^source");
  const next = parseStreamingMarkdownChunk(
    partial,
    "]: Alpha https://a.test\n",
  );
  const textNodes = next.nodes.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const renderedText = textNodes.map((node) => node.text).join("");

  expect(renderedText).toContain("Paragraph");
  expect(renderedText).not.toContain("[^source");
  expect(next.citations.definitions["source"]).toEqual({
    id: "source",
    text: "Alpha",
    url: "https://a.test",
  });
});

test("optimistically parses unfinished inline citation references while streaming", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(state, "Paragraph [^source");
  const textNodes = next.nodes.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const renderedText = textNodes.map((node) => node.text).join("");
  const citation = next.nodes.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "citation" }> =>
      node.type === "citation",
  );

  expect(renderedText).toContain("Paragraph ");
  expect(renderedText).not.toContain("[^source");
  expect(citation?.idRef).toBe("source");
  expect(citation?.closed).toBe(false);
});

test("emits soft and hard break nodes inside paragraphs", () => {
  const result = parseAll("alpha\nbeta  \ngamma\\\ndelta");

  const breaks = result.nodes.filter(
    (node) => node.type === "soft-break" || node.type === "hard-break",
  );

  expect(breaks.map((node) => node.type)).toEqual([
    "soft-break",
    "hard-break",
    "hard-break",
  ]);
});

test("normalizes CRLF and split carriage return at chunk boundaries", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const a = parseStreamingMarkdownChunk(state, "alpha\r");
  const b = parseStreamingMarkdownChunk(a, "\nbeta\r\ngamma\r");
  const c = finalizeStreamingMarkdown(b);

  const breaks = c.nodes.filter(
    (node) => node.type === "soft-break" || node.type === "hard-break",
  );

  expect(breaks.length).toBeGreaterThanOrEqual(2);
  expect(c.pendingCarriageReturn).toBe(false);
});

test("supports segmenter false by returning empty text segments", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const result = parseStreamingMarkdownChunk(state, "hello world");
  const textNode = result.nodes.find((node) => node.type === "text");

  expect(textNode).toBeDefined();
  expect(
    textNode && textNode.type === "text" ? textNode.segments : ["x"],
  ).toEqual([]);
});

test("preserves node identity for unchanged subtree across chunks", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const a = parseStreamingMarkdownChunk(state, "first\n\nsecond");
  const firstParagraphA = a.nodes.find(
    (node) => node.type === "paragraph" && node.range.start === 0,
  );

  const b = parseStreamingMarkdownChunk(a, " line\n");
  const firstParagraphB = b.nodes.find(
    (node) => node.type === "paragraph" && node.range.start === 0,
  );

  expect(firstParagraphA).toBeDefined();
  expect(firstParagraphB).toBeDefined();
  expect(firstParagraphB).toBe(firstParagraphA);
});

test("keeps unterminated inline constructs optimistic and open", () => {
  const result = parseAll("**strong");
  const strong = result.nodes.find((node) => node.type === "strong");

  expect(strong?.closed).toBe(false);
  expect(result.warnings).toEqual([]);
});

test("keeps root open while streaming and closes on finalize", () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const partial = parseStreamingMarkdownChunk(state, "hello");
  const rootPartial = partial.nodes.find((node) => node.id === partial.rootId);

  const final = finalizeStreamingMarkdown(partial);
  const rootFinal = final.nodes.find((node) => node.id === final.rootId);

  expect(rootPartial?.closed).toBe(false);
  expect(rootFinal?.closed).toBe(true);
});

test("segments optimistic word tails across streaming chunks", () => {
  const state = createStreamingMarkdownParserState({
    segmenter: { granularity: "word" },
  });

  const a = parseStreamingMarkdownChunk(state, "hello wo");
  const textNodeA = a.nodes.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );

  const b = parseStreamingMarkdownChunk(a, "rld");
  const textNodeB = b.nodes.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );

  expect(textNodeA).toBeDefined();
  expect(textNodeB).toBeDefined();
  expect(textNodeA?.segments.map((segment) => segment.text)).toEqual([
    "hello",
    " ",
    "wo",
  ]);
  expect(textNodeB?.segments.map((segment) => segment.text)).toEqual([
    "hello",
    " ",
    "world",
  ]);
  expect(textNodeB?.segments).toHaveLength(3);
});

test("reuses unchanged segment object identities when optimistic tails grow", () => {
  const state = createStreamingMarkdownParserState({
    segmenter: { granularity: "word" },
  });

  const a = parseStreamingMarkdownChunk(state, "hello wo");
  const textNodeA = a.nodes.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );

  const b = parseStreamingMarkdownChunk(a, "rld");
  const textNodeB = b.nodes.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );

  expect(textNodeA).toBeDefined();
  expect(textNodeB).toBeDefined();
  expect(textNodeA?.segments[0]).toBe(textNodeB?.segments[0]);
  expect(textNodeA?.segments[1]).toBe(textNodeB?.segments[1]);
  expect(textNodeA?.segments[2]).not.toBe(textNodeB?.segments[2]);
});

test("does not retain stale raw-link segments after inline link closes", () => {
  const state = createStreamingMarkdownParserState({
    segmenter: { granularity: "word" },
  });

  const partial = parseStreamingMarkdownChunk(
    state,
    "**Hashbrowns** at [Waffle House](ht",
  );
  const next = parseStreamingMarkdownChunk(
    partial,
    "tps://www.wafflehouse.com) ",
  );
  const byId = new Map(next.nodes.map((node) => [node.id, node]));
  const root = next.rootId == null ? null : byId.get(next.rootId);
  const paragraphId = root && "children" in root ? root.children[0] : null;
  const paragraph =
    typeof paragraphId === "number" ? byId.get(paragraphId) : null;

  const paragraphChildren =
    paragraph && "children" in paragraph
      ? paragraph.children
          .map((id) => byId.get(id))
          .filter((node) => node != null)
      : [];
  const topLevelTextNodes = paragraphChildren.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const linkNode = paragraphChildren.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "link" }> =>
      node.type === "link",
  );
  const leftTextNode = topLevelTextNodes.find((node) => node.text === " at ");

  expect(linkNode).toBeDefined();
  expect(leftTextNode).toBeDefined();
  expect(leftTextNode?.segments.map((segment) => segment.text)).toEqual([
    " ",
    "at",
    " ",
  ]);
  expect(
    topLevelTextNodes.some((node) =>
      node.segments.some((segment) => segment.text.includes("[")),
    ),
  ).toBe(false);
});

test("does not retain stale delimiter segments after emphasis closes", () => {
  const state = createStreamingMarkdownParserState({
    segmenter: { granularity: "word" },
  });

  const partial = parseStreamingMarkdownChunk(state, "alpha *bo");
  const next = parseStreamingMarkdownChunk(partial, "ld* omega");
  const byId = new Map(next.nodes.map((node) => [node.id, node]));
  const root = next.rootId == null ? null : byId.get(next.rootId);
  const paragraphId = root && "children" in root ? root.children[0] : null;
  const paragraph =
    typeof paragraphId === "number" ? byId.get(paragraphId) : null;

  const paragraphChildren =
    paragraph && "children" in paragraph
      ? paragraph.children
          .map((id) => byId.get(id))
          .filter((node) => node != null)
      : [];
  const topLevelTextNodes = paragraphChildren.filter(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "text" }> =>
      node.type === "text",
  );
  const emphasisNode = paragraphChildren.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: "em" }> =>
      node.type === "em",
  );

  expect(emphasisNode).toBeDefined();
  expect(
    topLevelTextNodes.some((node) =>
      node.segments.some((segment) => segment.text.includes("*")),
    ),
  ).toBe(false);
});
