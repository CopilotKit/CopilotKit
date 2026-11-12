import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from "./index";
import type {
  StreamingMarkdownAstNode,
  StreamingMarkdownParserOptions,
} from "./index";

function parseInChunks(
  chunks: string[],
  options: Partial<StreamingMarkdownParserOptions> = {},
) {
  let state = createStreamingMarkdownParserState({
    segmenter: false,
    ...options,
  });

  for (const chunk of chunks) {
    state = parseStreamingMarkdownChunk(state, chunk);
  }

  return state;
}

function parseAndFinalize(
  chunks: string[],
  options: Partial<StreamingMarkdownParserOptions> = {},
) {
  const parsed = parseInChunks(chunks, options);

  return finalizeStreamingMarkdown(parsed);
}

function findSingle(
  nodes: StreamingMarkdownAstNode[],
  type: StreamingMarkdownAstNode["type"],
) {
  return nodes.find((node) => node.type === type);
}

test("parses chunked link split across marker boundaries", () => {
  const chunks = ["[lin", "k](", "https://a.test", ")"];

  const state = parseInChunks(chunks);
  const link = state.nodes.find((node) => node.type === "link");

  expect(link).toBeDefined();
  expect(link && link.type === "link" ? link.url : "").toBe("https://a.test");
});

test("parses chunked citation and later definition", () => {
  const chunks = ["Before [^a", "]\n\n[^a]: ", "Alpha https://a.test"];

  const state = parseInChunks(chunks);
  const citation = state.nodes.find((node) => node.type === "citation");

  expect(citation).toBeDefined();
  expect(state.citations.numbers).toEqual({ a: 1 });
  expect(state.citations.definitions["a"]).toEqual({
    id: "a",
    text: "Alpha",
    url: "https://a.test",
  });
});

test("supports link title syntaxes in integration flow", () => {
  const chunks = [
    '[a](https://a.test "t") ',
    "[b](https://b.test 'u') ",
    "[c](https://c.test (v))",
  ];

  const state = parseInChunks(chunks);
  const links = state.nodes.filter((node) => node.type === "link");

  expect(links).toHaveLength(3);
  expect(links[0].type === "link" ? links[0].title : "").toBe("t");
  expect(links[1].type === "link" ? links[1].title : "").toBe("u");
  expect(links[2].type === "link" ? links[2].title : "").toBe("v");
});

test("parses escaped delimiters as literal text", () => {
  const chunks = ["\\*not em\\* and \\[not link\\]"];

  const state = parseInChunks(chunks);
  const text = state.nodes
    .filter((node) => node.type === "text")
    .map((node) => (node.type === "text" ? node.text : ""))
    .join("");

  expect(text.includes("*not em*")).toBe(true);
  expect(text.includes("[not link]")).toBe(true);
});

test("trims punctuation on bare autolinks but keeps balanced parens", () => {
  const chunks = ["https://a.test., (https://b.test/path(1))!"];

  const state = parseInChunks(chunks);
  const autolinks = state.nodes.filter((node) => node.type === "autolink");

  expect(autolinks).toHaveLength(2);
  expect(autolinks[0].type === "autolink" ? autolinks[0].text : "").toBe(
    "https://a.test",
  );
  expect(autolinks[1].type === "autolink" ? autolinks[1].text : "").toBe(
    "https://b.test/path(1)",
  );
});

test("parses nested inline formatting inside link labels", () => {
  const chunks = ["[**bold** and *em*](https://x.test)"];

  const state = parseInChunks(chunks);

  expect(state.nodes.some((node) => node.type === "link")).toBe(true);
  expect(state.nodes.some((node) => node.type === "strong")).toBe(true);
  expect(state.nodes.some((node) => node.type === "em")).toBe(true);
});

test("keeps list ordering split across chunks", () => {
  const chunks = ["1. a\n", "2. b\n", "\n- c\n- d\n"];

  const state = parseInChunks(chunks);
  const lists = state.nodes.filter((node) => node.type === "list");

  expect(lists).toHaveLength(2);
  expect(lists[0].type === "list" ? lists[0].ordered : false).toBe(true);
  expect(lists[1].type === "list" ? lists[1].ordered : true).toBe(false);
});

test("tracks ordered list start value from first marker", () => {
  const chunks = ["3. c\n4. d\n"];

  const state = parseInChunks(chunks);
  const list = findSingle(state.nodes, "list");

  expect(list && list.type === "list" ? list.start : null).toBe(3);
});

test("applies block precedence so list markers win before heading parsing", () => {
  const chunks = ["1. # not-a-heading\n"];

  const state = parseInChunks(chunks);
  const heading = findSingle(state.nodes, "heading");
  const list = findSingle(state.nodes, "list");

  expect(list).toBeDefined();
  expect(heading).toBeUndefined();
});

test("marks list as loose when blank lines appear between items", () => {
  const chunks = ["- one\n\n- two\n"];

  const state = parseInChunks(chunks);
  const list = findSingle(state.nodes, "list");

  expect(list).toBeDefined();
  expect(list && list.type === "list" ? list.tight : true).toBe(false);
});

test("requires list continuation indentation to align with marker content", () => {
  const chunks = ["1. one\n  two\n   three\n"];

  const state = parseInChunks(chunks);
  const lists = state.nodes.filter((node) => node.type === "list");
  const paragraphs = state.nodes.filter((node) => node.type === "paragraph");

  expect(lists).toHaveLength(1);
  expect(paragraphs.length).toBeGreaterThan(1);
});

test("parses blockquote with blank lines and lazy continuation", () => {
  const chunks = ["> q1\n", "lazy\n\n", "> q2\n"];

  const state = parseInChunks(chunks);
  const quote = state.nodes.find((node) => node.type === "blockquote");

  expect(quote).toBeDefined();
  expect(state.nodes.some((node) => node.type === "soft-break")).toBe(true);
});

test("stops blockquote lazy continuation when a new block starts", () => {
  const chunks = ["> quoted\n- list item\n"];

  const state = parseInChunks(chunks);
  const quote = findSingle(state.nodes, "blockquote");
  const list = findSingle(state.nodes, "list");

  expect(quote).toBeDefined();
  expect(list).toBeDefined();
});

test("parses table that streams line by line", () => {
  const chunks = ["| A | B |\n", "| :--- | ---: |\n", "| 1 | 2 |\n"];

  const state = parseInChunks(chunks);
  const table = state.nodes.find((node) => node.type === "table");

  expect(table).toBeDefined();
  expect(table && table.type === "table" ? table.align : []).toEqual([
    "left",
    "right",
  ]);
});

test("parses all table alignments in one header row", () => {
  const chunks = [
    "| A | B | C | D |\n",
    "| :--- | ---: | :---: | --- |\n",
    "| 1 | 2 | 3 | 4 |\n",
  ];

  const state = parseInChunks(chunks);
  const table = findSingle(state.nodes, "table");

  expect(table && table.type === "table" ? table.align : []).toEqual([
    "left",
    "right",
    "center",
    "none",
  ]);
});

test("keeps code fence open before close arrives and then closes", () => {
  const beforeClose = parseInChunks(["```ts\nconst x = 1;"]);

  const open = beforeClose.nodes.find((node) => node.type === "code-block");
  const afterClose = parseStreamingMarkdownChunk(beforeClose, "\n```\n");
  const closed = afterClose.nodes.find((node) => node.type === "code-block");

  expect(open?.closed).toBe(false);
  expect(closed?.closed).toBe(true);
});

test("keeps unterminated fence optimistic without warnings", () => {
  const beforeClose = parseInChunks(["```\nline"]);

  const afterClose = parseStreamingMarkdownChunk(beforeClose, "\n```");
  const openFence = findSingle(beforeClose.nodes, "code-block");
  const closedFence = findSingle(afterClose.nodes, "code-block");

  expect(openFence?.closed).toBe(false);
  expect(closedFence?.closed).toBe(true);
  expect(beforeClose.warnings).toEqual([]);
  expect(afterClose.warnings).toEqual([]);
});

test("parses setext heading across chunk boundaries", () => {
  const chunks = ["Title\n", "---\n"];

  const state = parseInChunks(chunks);
  const heading = findSingle(state.nodes, "heading");

  expect(heading).toBeDefined();
  expect(heading && heading.type === "heading" ? heading.level : 0).toBe(2);
});

test("parses thematic break as a distinct block node", () => {
  const chunks = ["before\n\n***\n\nafter"];

  const state = parseInChunks(chunks);
  const breakNode = findSingle(state.nodes, "thematic-break");

  expect(breakNode).toBeDefined();
});

test("parses image with title and alt text", () => {
  const chunks = ['![hero image](https://img.test/h.png "cover")'];

  const state = parseInChunks(chunks);
  const image = findSingle(state.nodes, "image");

  expect(image).toBeDefined();
  expect(image && image.type === "image" ? image.alt : "").toBe("hero image");
  expect(image && image.type === "image" ? image.url : "").toBe(
    "https://img.test/h.png",
  );
  expect(image && image.type === "image" ? image.title : "").toBe("cover");
});

test("parses inline code with multi-backtick delimiter", () => {
  const chunks = ["``code ` literal``"];

  const state = parseInChunks(chunks);
  const inlineCode = findSingle(state.nodes, "inline-code");

  expect(inlineCode).toBeDefined();
  expect(
    inlineCode && inlineCode.type === "inline-code" ? inlineCode.text : "",
  ).toBe("code ` literal");
});

test("parses autolinks in angle brackets for url and email", () => {
  const chunks = ["<https://a.test> and <a@b.test>"];

  const state = parseInChunks(chunks);
  const autolinks = state.nodes.filter((node) => node.type === "autolink");

  expect(autolinks).toHaveLength(2);
  expect(autolinks[0].type === "autolink" ? autolinks[0].url : "").toBe(
    "https://a.test",
  );
  expect(autolinks[1].type === "autolink" ? autolinks[1].url : "").toBe(
    "mailto:a@b.test",
  );
});

test("parses bare email autolink and applies mailto scheme", () => {
  const chunks = ["mail me at user@example.test please"];

  const state = parseInChunks(chunks);
  const autolink = findSingle(state.nodes, "autolink");

  expect(autolink).toBeDefined();
  expect(autolink && autolink.type === "autolink" ? autolink.url : "").toBe(
    "mailto:user@example.test",
  );
});

test("does not parse bare autolinks when disabled", () => {
  const chunks = ["visit https://a.test and mail a@b.test"];

  const state = parseInChunks(chunks, { enableAutolinks: false });

  expect(state.nodes.some((node) => node.type === "autolink")).toBe(false);
});

test("does not parse tables when disabled", () => {
  const chunks = ["| A | B |\n", "| --- | --- |\n", "| 1 | 2 |\n"];

  const state = parseInChunks(chunks, { enableTables: false });

  expect(state.nodes.some((node) => node.type === "table")).toBe(false);
  expect(state.nodes.some((node) => node.type === "paragraph")).toBe(true);
});

test("tracks citation numbering by first inline reference order", () => {
  const chunks = ["[^b] [^a] [^b]\n\n[^a]: Alpha\n[^b]: Beta"];

  const state = parseAndFinalize(chunks);

  expect(state.citations.order).toEqual(["b", "a"]);
  expect(state.citations.numbers).toEqual({ b: 1, a: 2 });
  expect(state.citations.definitions["a"]).toEqual({ id: "a", text: "Alpha" });
  expect(state.citations.definitions["b"]).toEqual({ id: "b", text: "Beta" });
});

test("keeps first duplicate citation definition and warns", () => {
  const chunks = ["[^a]: One\n[^a]: Two\n\n[^a]"];

  const state = parseAndFinalize(chunks);

  expect(state.citations.definitions["a"]).toEqual({ id: "a", text: "One" });
  expect(
    state.warnings.some(
      (warning) => warning.code === "invalid_citation_definition",
    ),
  ).toBe(true);
});

test("supports citation definitions before first inline citation", () => {
  const chunks = ["[^ref]: Defined first\n\nLater [^ref]"];

  const state = parseAndFinalize(chunks);
  const citation = findSingle(state.nodes, "citation");

  expect(citation && citation.type === "citation" ? citation.number : 0).toBe(
    1,
  );
  expect(state.citations.definitions["ref"]).toEqual({
    id: "ref",
    text: "Defined first",
  });
});

test("keeps paragraph open without trailing newline and closes after newline", () => {
  const openState = parseInChunks(["hello"]);

  const closedState = parseStreamingMarkdownChunk(openState, "\n");
  const openParagraph = findSingle(openState.nodes, "paragraph");
  const closedParagraph = findSingle(closedState.nodes, "paragraph");

  expect(openParagraph?.closed).toBe(false);
  expect(closedParagraph?.closed).toBe(true);
});

test("represents soft and hard breaks after CRLF and CR normalization", () => {
  const chunks = ["a  \r\n", "b\\\rc"];

  const state = parseAndFinalize(chunks);
  const breaks = state.nodes.filter(
    (node) => node.type === "soft-break" || node.type === "hard-break",
  );

  expect(breaks.map((node) => node.type)).toEqual(["hard-break", "hard-break"]);
});

test("preserves object identity for unchanged nodes across appended chunks", () => {
  const initial = parseInChunks(["alpha\n\nbeta"]);

  const next = parseStreamingMarkdownChunk(initial, " more");
  const initialText = initial.nodes.find(
    (node) => node.type === "text" && node.text === "alpha",
  );
  const nextText = next.nodes.find(
    (node) => node.type === "text" && node.text === "alpha",
  );

  expect(initialText).toBeDefined();
  expect(nextText).toBeDefined();
  expect(nextText).toBe(initialText);
});

test("retains text segment array identity for unchanged text nodes", () => {
  const initial = parseInChunks(["stay\n\nput"], { segmenter: true });

  const next = parseStreamingMarkdownChunk(initial, " now");
  const initialText = initial.nodes.find(
    (node) => node.type === "text" && node.text === "stay",
  );
  const nextText = next.nodes.find(
    (node) => node.type === "text" && node.text === "stay",
  );

  const initialSegments =
    initialText && initialText.type === "text" ? initialText.segments : null;
  const nextSegments =
    nextText && nextText.type === "text" ? nextText.segments : null;

  expect(initialSegments).toBeDefined();
  expect(nextSegments).toBeDefined();
  expect(nextSegments).toBe(initialSegments);
});

test("keeps unmatched inline delimiter optimistic and then closes when completed", () => {
  const openState = parseInChunks(["**bold"]);
  const openStrong = findSingle(openState.nodes, "strong");

  const closedState = parseStreamingMarkdownChunk(openState, "**");
  const closedStrong = findSingle(closedState.nodes, "strong");

  expect(openStrong?.closed).toBe(false);
  expect(closedStrong?.closed).toBe(true);
  expect(openState.warnings).toEqual([]);
  expect(closedState.warnings).toEqual([]);
});

test("tracks index and line coordinates after multiple streaming updates", () => {
  const a = parseInChunks(["row1\nrow2"]);

  const b = parseStreamingMarkdownChunk(a, "\nrow3");

  expect(b.index).toBe(14);
  expect(b.line).toBe(3);
  expect(b.column).toBe(5);
});

test("does not infer completion when the stream ends at a closed block boundary", () => {
  const state = parseInChunks(["hello\n"]);

  expect(state.isComplete).toBe(false);
  expect(findSingle(state.nodes, "document")?.closed).toBe(true);
});

test("finalize closes document root and marks parse complete", () => {
  const partial = parseInChunks(["hello"]);

  const final = finalizeStreamingMarkdown(partial);
  const root = final.nodes.find((node) => node.id === final.rootId);

  expect(root?.closed).toBe(true);
  expect(final.isComplete).toBe(true);
});
