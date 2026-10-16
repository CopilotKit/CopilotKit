import { describe, expect, it } from "vitest";
import { splitA2UIMarkdown } from "../a2ui-markdown";

describe("splitA2UIMarkdown", () => {
  it("returns a single markdown segment when there is no fence", () => {
    expect(splitA2UIMarkdown("# Hi\n\nplain text")).toEqual([
      { type: "markdown", text: "# Hi\n\nplain text" },
    ]);
  });

  it("splits prose, a closed a2ui fence, and trailing prose in order", () => {
    const md =
      'Intro\n\n```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s"}}\n```\n\nOutro';
    expect(splitA2UIMarkdown(md)).toEqual([
      { type: "markdown", text: "Intro\n\n" },
      {
        type: "a2ui",
        index: 0,
        text: '{"version":"v0.9","createSurface":{"surfaceId":"s"}}\n',
        closed: true,
      },
      { type: "markdown", text: "\n\nOutro" },
    ]);
  });

  it("marks an unterminated fence as open and keeps its partial body", () => {
    const md =
      'Intro\n```a2ui\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","comp';
    const segs = splitA2UIMarkdown(md);
    expect(segs[1]).toEqual({
      type: "a2ui",
      index: 0,
      text: '{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","comp',
      closed: false,
    });
  });

  it("treats a bare ```a2ui opener with no body yet as an open empty fence", () => {
    expect(splitA2UIMarkdown("Text\n```a2ui")).toEqual([
      { type: "markdown", text: "Text\n" },
      { type: "a2ui", index: 0, text: "", closed: false },
    ]);
  });

  it("numbers multiple fences and leaves non-a2ui fences inside markdown", () => {
    const md =
      "```a2ui\n{}\n```\nmid\n```js\nconsole.log(1)\n```\n```a2ui\n{}\n```";
    expect(splitA2UIMarkdown(md)).toEqual([
      { type: "a2ui", index: 0, text: "{}\n", closed: true },
      { type: "markdown", text: "\nmid\n```js\nconsole.log(1)\n```\n" },
      { type: "a2ui", index: 1, text: "{}\n", closed: true },
    ]);
  });

  it("ignores a2ui markers inside other fences", () => {
    const md = "```md\n```a2ui\n{}\n```\n";
    expect(splitA2UIMarkdown(md)).toEqual([{ type: "markdown", text: md }]);
  });

  it("accepts trailing whitespace and info-string extras on the opener", () => {
    const md = "```a2ui   \n{}\n```";
    expect(splitA2UIMarkdown(md)[0]?.type).toBe("a2ui");
  });

  it("does not treat an indented (list item) fence as a top-level a2ui fence", () => {
    const md = "- item\n  ```a2ui\n  {}\n  ```";
    expect(splitA2UIMarkdown(md)).toEqual([{ type: "markdown", text: md }]);
  });

  it("ignores a2ui markers inside a json fence that never closes", () => {
    const md = 'Look:\n```json\n{"a":1}\n```a2ui\n{}';
    expect(splitA2UIMarkdown(md)).toEqual([{ type: "markdown", text: md }]);
  });

  it("keeps the trailing newline of an open fence body", () => {
    expect(splitA2UIMarkdown("```a2ui\n{}\n")).toEqual([
      { type: "a2ui", index: 0, text: "{}\n", closed: false },
    ]);
  });

  it("drops a half-streamed closing fence from an open a2ui body", () => {
    expect(splitA2UIMarkdown("```a2ui\n{}\n``")).toEqual([
      { type: "a2ui", index: 0, text: "{}\n", closed: false },
    ]);
  });

  it("does not close a fence on a shorter or different marker", () => {
    const md = "````a2ui\n{}\n```\n~~~~\n";
    expect(splitA2UIMarkdown(md)).toEqual([
      { type: "a2ui", index: 0, text: "{}\n```\n~~~~\n", closed: false },
    ]);
  });

  it("closes an empty a2ui fence with an empty body", () => {
    expect(splitA2UIMarkdown("```a2ui\n```")).toEqual([
      { type: "a2ui", index: 0, text: "", closed: true },
    ]);
  });

  it("round-trips prose byte-identically, including CRLF-free whitespace", () => {
    const md = "a  \n\n\n```py\nx = 1\n```  \n\ttail\n";
    expect(splitA2UIMarkdown(md)).toEqual([{ type: "markdown", text: md }]);
  });

  it("detects CRLF fences and keeps the prose byte-identical", () => {
    const md = 'hi\r\n```a2ui\r\n{"a":1}\r\n```\r\nbye';
    const segs = splitA2UIMarkdown(md);
    expect(segs).toEqual([
      { type: "markdown", text: "hi\r\n" },
      { type: "a2ui", index: 0, text: '{"a":1}\r\n', closed: true },
      { type: "markdown", text: "\r\nbye" },
    ]);
  });

  it("detects an open CRLF fence while it streams", () => {
    expect(splitA2UIMarkdown('```a2ui\r\n{"a":1}\r\n``')).toEqual([
      { type: "a2ui", index: 0, text: '{"a":1}\r\n', closed: false },
    ]);
  });
});

describe("splitA2UIMarkdown fence target", () => {
  /** The single a2ui segment of `md`. */
  function onlyFence(md: string) {
    const fences = splitA2UIMarkdown(md).filter((s) => s.type === "a2ui");
    expect(fences).toHaveLength(1);
    return fences[0];
  }

  it("reads target=<id> from the info string", () => {
    expect(
      splitA2UIMarkdown("Hi\n```a2ui target=recommendations\n{}\n```"),
    ).toEqual([
      { type: "markdown", text: "Hi\n" },
      {
        type: "a2ui",
        index: 0,
        text: "{}\n",
        closed: true,
        target: "recommendations",
      },
    ]);
  });

  it("has no target when the info string names none", () => {
    expect(onlyFence("```a2ui\n{}\n```")).not.toHaveProperty("target");
    expect(onlyFence("```a2ui title=x\n{}\n```")).not.toHaveProperty("target");
  });

  it("ignores other tokens around the target token", () => {
    expect(
      onlyFence("```a2ui title=x  target=side-panel  extra\n{}\n```"),
    ).toEqual({
      type: "a2ui",
      index: 0,
      text: "{}\n",
      closed: true,
      target: "side-panel",
    });
  });

  it("ignores an empty target= token", () => {
    expect(onlyFence("```a2ui target=\n{}\n```")).not.toHaveProperty("target");
  });

  it("keeps the target on a fence that is still streaming", () => {
    expect(onlyFence('```a2ui target=recs\r\n{"a":')).toEqual({
      type: "a2ui",
      index: 0,
      text: '{"a":',
      closed: false,
      target: "recs",
    });
  });

  it("keeps a non-a2ui fence with a target token as prose", () => {
    const md = "```json target=recs\n{}\n```\n";
    expect(splitA2UIMarkdown(md)).toEqual([{ type: "markdown", text: md }]);
  });

  it("does not read target as the language", () => {
    const md = "```target=recs a2ui\n{}\n```";
    expect(splitA2UIMarkdown(md)).toEqual([{ type: "markdown", text: md }]);
  });
});
