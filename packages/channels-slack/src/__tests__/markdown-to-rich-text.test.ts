import { describe, expect, it } from "vitest";
import {
  markdownToRichTextRuns,
  needsRichText,
  truncateRuns,
} from "../markdown-to-rich-text.js";

const ISSUE_URL = "https://linear.app/copilotkit/issue/CPK-1234";

describe("markdownToRichTextRuns", () => {
  it("returns a single plain run for plain text", () => {
    const runs = markdownToRichTextRuns("🟡 In Progress");
    expect(runs).toEqual([{ type: "text", text: "🟡 In Progress" }]);
    expect(needsRichText(runs)).toBe(false);
  });

  it("returns no runs for empty input", () => {
    expect(markdownToRichTextRuns("")).toEqual([]);
    expect(needsRichText([])).toBe(false);
  });

  it("converts a bold markdown link into a styled link run", () => {
    const runs = markdownToRichTextRuns(`[**CPK-1234**](${ISSUE_URL})`);
    expect(runs).toEqual([
      {
        type: "link",
        url: ISSUE_URL,
        text: "CPK-1234",
        style: { bold: true },
      },
    ]);
    expect(needsRichText(runs)).toBe(true);
  });

  it("converts mixed inline markup into one run per span", () => {
    expect(
      markdownToRichTextRuns(
        `**bold** plain \`code\` — [unstyled link](${ISSUE_URL})`,
      ),
    ).toEqual([
      { type: "text", text: "bold", style: { bold: true } },
      { type: "text", text: " plain " },
      { type: "text", text: "code", style: { code: true } },
      { type: "text", text: " — " },
      { type: "link", url: ISSUE_URL, text: "unstyled link" },
    ]);
  });

  it("carries italic and strikethrough", () => {
    expect(markdownToRichTextRuns("*soft* and ~~gone~~")).toEqual([
      { type: "text", text: "soft", style: { italic: true } },
      { type: "text", text: " and " },
      { type: "text", text: "gone", style: { strike: true } },
    ]);
  });

  it("leaves word-internal markers alone", () => {
    const runs = markdownToRichTextRuns("provider_file_id and 2 * 3 * 4");
    expect(runs).toEqual([
      { type: "text", text: "provider_file_id and 2 * 3 * 4" },
    ]);
    expect(needsRichText(runs)).toBe(false);
  });

  it("treats a bare URL as plain text (Slack does not linkify it either)", () => {
    expect(needsRichText(markdownToRichTextRuns(ISSUE_URL))).toBe(false);
  });
});

describe("truncateRuns", () => {
  it("leaves runs within budget untouched", () => {
    const runs = markdownToRichTextRuns(`[**CPK-1234**](${ISSUE_URL})`);
    expect(truncateRuns(runs, 2000)).toEqual(runs);
  });

  it("cuts the straddling run and drops the rest, landing on the budget", () => {
    const runs = truncateRuns(
      [
        { type: "text", text: "abcde", style: { bold: true } },
        { type: "link", url: ISSUE_URL, text: "dropped" },
      ],
      3,
    );
    expect(runs).toEqual([
      { type: "text", text: "ab…", style: { bold: true } },
    ]);
  });

  it("does not count link URLs against the visible-text budget", () => {
    const runs: Parameters<typeof truncateRuns>[0] = [
      { type: "link", url: `${ISSUE_URL}?very=long&query=string`, text: "ok" },
    ];
    expect(truncateRuns(runs, 5)).toEqual(runs);
  });
});
