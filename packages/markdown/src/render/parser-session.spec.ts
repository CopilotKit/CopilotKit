import { updateStreamingMarkdownParserSession } from "./parser-session";

function texts(
  session: ReturnType<typeof updateStreamingMarkdownParserSession>,
) {
  return session.parserState.nodes.flatMap((node) =>
    node.type === "text" ? [node.text] : [],
  );
}

function headingOf(
  session: ReturnType<typeof updateStreamingMarkdownParserSession>,
) {
  return session.parserState.nodes.find((node) => node.type === "heading");
}

const NO_SEGMENTS = { segmenter: false } as const;

describe("updateStreamingMarkdownParserSession", () => {
  test("returns the same session when nothing changed", () => {
    const first = updateStreamingMarkdownParserSession(
      null,
      "# A",
      NO_SEGMENTS,
      false,
    );
    expect(
      updateStreamingMarkdownParserSession(first, "# A", NO_SEGMENTS, false),
    ).toBe(first);
  });

  test("parses an appended suffix and keeps unchanged nodes", () => {
    const first = updateStreamingMarkdownParserSession(
      null,
      "# A\n\nPa",
      NO_SEGMENTS,
      false,
    );
    const next = updateStreamingMarkdownParserSession(
      first,
      "# A\n\nPara",
      NO_SEGMENTS,
      false,
    );
    expect(texts(next)).toEqual(["A", "Para"]);
    expect(headingOf(next)).toBe(headingOf(first));
  });

  test("re-parses from scratch when the text is replaced", () => {
    const first = updateStreamingMarkdownParserSession(
      null,
      "first",
      NO_SEGMENTS,
      false,
    );
    const next = updateStreamingMarkdownParserSession(
      first,
      "second",
      NO_SEGMENTS,
      false,
    );
    expect(texts(next)).toEqual(["second"]);
  });

  test("re-parses when options change", () => {
    const first = updateStreamingMarkdownParserSession(
      null,
      "$x$",
      NO_SEGMENTS,
      true,
    );
    const next = updateStreamingMarkdownParserSession(
      first,
      "$x$",
      { ...NO_SEGMENTS, enableMath: true },
      true,
    );
    expect(first.parserState.nodes.some((node) => node.type === "math")).toBe(
      false,
    );
    expect(next.parserState.nodes.some((node) => node.type === "math")).toBe(
      true,
    );
  });

  test("finalizes and re-opens when only the completion flag toggles", () => {
    const open = updateStreamingMarkdownParserSession(
      null,
      "Para",
      NO_SEGMENTS,
      false,
    );
    const done = updateStreamingMarkdownParserSession(
      open,
      "Para",
      NO_SEGMENTS,
      true,
    );
    expect(done.parserState.isComplete).toBe(true);
    const reopened = updateStreamingMarkdownParserSession(
      done,
      "Para",
      NO_SEGMENTS,
      false,
    );
    expect(reopened.parserState.isComplete).toBe(false);
  });
});
