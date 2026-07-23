import { describe, it, expect } from "vitest";
import { autoCloseOpenMarkdown } from "../auto-close-streaming.js";

describe("autoCloseOpenMarkdown", () => {
  // ── No-op cases ──────────────────────────────────────────────────
  it("returns empty string unchanged", () => {
    expect(autoCloseOpenMarkdown("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(autoCloseOpenMarkdown("just plain text 123")).toBe(
      "just plain text 123",
    );
  });

  it("does not modify already-balanced markdown", () => {
    expect(autoCloseOpenMarkdown("**bold** and *italic* and ~~strike~~")).toBe(
      "**bold** and *italic* and ~~strike~~",
    );
  });

  // ── Bold ──────────────────────────────────────────────────────────
  it("closes an unbalanced **opening — `**hello` → `**hello**`", () => {
    expect(autoCloseOpenMarkdown("**hello")).toBe("**hello**");
  });

  it("does NOT close a `**` with nothing after it", () => {
    // Just opened — closing would render as `****`, which looks worse.
    expect(autoCloseOpenMarkdown("hi **")).toBe("hi **");
  });

  it("closes `__bold` as `__bold__`", () => {
    expect(autoCloseOpenMarkdown("__bold")).toBe("__bold__");
  });

  // ── Italic ───────────────────────────────────────────────────────
  it("closes `*italic` → `*italic*`", () => {
    expect(autoCloseOpenMarkdown("*italic")).toBe("*italic*");
  });

  it("closes `_italic` → `_italic_`", () => {
    expect(autoCloseOpenMarkdown("_italic")).toBe("_italic_");
  });

  it("does NOT close a `*` with nothing after it", () => {
    expect(autoCloseOpenMarkdown("text *")).toBe("text *");
  });

  // ── Strike ───────────────────────────────────────────────────────
  it("closes `~~strike` → `~~strike~~`", () => {
    expect(autoCloseOpenMarkdown("~~strike")).toBe("~~strike~~");
  });

  // ── Inline code ──────────────────────────────────────────────────
  it("closes `` `code `` → `` `code` ``", () => {
    expect(autoCloseOpenMarkdown("`code")).toBe("`code`");
  });

  it("doesn't touch content inside paired inline code", () => {
    // `code with *stars*` — the stars are inside code, so no italic close.
    expect(autoCloseOpenMarkdown("`code *stars*` and more")).toBe(
      "`code *stars*` and more",
    );
  });

  it("treats unbalanced markers INSIDE inline code as opaque", () => {
    // `**foo` is inside an unclosed inline → we close the backtick, but
    // don't try to close the `**` inside code.
    expect(autoCloseOpenMarkdown("see `**foo")).toBe("see `**foo`");
  });

  // ── Fenced code ──────────────────────────────────────────────────
  it("closes an open fence — adds `\\n```` after the content", () => {
    const input = "```py\ndef foo():";
    const out = autoCloseOpenMarkdown(input);
    expect(out.startsWith(input)).toBe(true);
    expect(out.trim().endsWith("```")).toBe(true);
  });

  it("does NOT close a bare ``` with nothing after it (just opened)", () => {
    expect(autoCloseOpenMarkdown("```")).toBe("```");
    expect(autoCloseOpenMarkdown("```py")).toBe("```py"); // language tag alone
  });

  it("balanced fences left untouched", () => {
    const input = "before\n```\ncode\n```\nafter";
    expect(autoCloseOpenMarkdown(input)).toBe(input);
  });

  it("balanced fence + unbalanced markers in surrounding text close correctly", () => {
    // The fence is paired; the trailing `**hel` outside the fence needs close.
    const input = "**hel ```code``` more text";
    const out = autoCloseOpenMarkdown(input);
    expect(out).toContain("**hel");
    expect(out).toContain("```code```");
    expect(out).toContain("**"); // close
  });

  it("markers inside paired fences don't count toward balance", () => {
    // Inside the fence we have `**oops`, but the markdown text is balanced.
    const input = "```\n**oops never closes\n``` after";
    expect(autoCloseOpenMarkdown(input)).toBe(input);
  });

  // ── Nesting ──────────────────────────────────────────────────────
  it("closes innermost first — `**bold _italic` → `**bold _italic_**`", () => {
    expect(autoCloseOpenMarkdown("**bold _italic")).toBe("**bold _italic_**");
  });

  it("doesn't double-close already-balanced inner markers", () => {
    expect(autoCloseOpenMarkdown("**bold _italic_ tail")).toBe(
      "**bold _italic_ tail**",
    );
  });

  // ── Stream-evolution: simulate consecutive deltas; the agent's eventual
  // close should NOT cause double-closes in the produced text. ──
  it("stream-evolution: agent eventually closes; auto-close adds nothing at that point", () => {
    const states = [
      "**h",
      "**he",
      "**hel",
      "**hell",
      "**hello",
      "**hello*",
      "**hello**",
    ];
    const out = states.map(autoCloseOpenMarkdown);
    // Intermediate states are closed
    expect(out[0]).toBe("**h**");
    expect(out[4]).toBe("**hello**");
    // Final state is unchanged (already balanced)
    expect(out[out.length - 1]).toBe("**hello**");
  });

  it("stream-evolution for fenced code: closes mid-stream; goes silent on real close", () => {
    const states = [
      "```py\n",
      "```py\ndef ",
      "```py\ndef foo():",
      "```py\ndef foo():\n    pass\n```",
    ];
    const out = states.map(autoCloseOpenMarkdown);
    // First state: just opened — no content yet, don't auto-close
    expect(out[0]).toBe("```py\n");
    // Middle states: closed
    expect(out[1]!.trim().endsWith("```")).toBe(true);
    expect(out[2]!.trim().endsWith("```")).toBe(true);
    // Final: agent emitted the close, balanced, no change
    expect(out[3]).toBe(states[3]);
  });

  // ── Combined ────────────────────────────────────────────────────
  it("closes bold before an unclosed fence opener, and closes the fence too", () => {
    // `**bold ` is open bold then a space; `\`\`\`code\n` opens a fence with
    // content. We close bold (with closer inserted before the trailing
    // space, so the space stays adjacent to the fence) and close the fence.
    const input = "**bold ```py\ndef foo():";
    const out = autoCloseOpenMarkdown(input);
    expect(out).toContain("**bold**"); // bold closed before fence
    expect(out).toContain("def foo():"); // fence content preserved
    expect(out.trim().endsWith("```")).toBe(true); // fence closed
  });

  // ── Sanity: long input ─────────────────────────────────────────
  it("handles a long buffer with mixed structures", () => {
    const lots = "**Bold opener** and `code` and *italic* and `unclosed inline";
    const out = autoCloseOpenMarkdown(lots);
    expect(out).toBe(
      "**Bold opener** and `code` and *italic* and `unclosed inline`",
    );
  });
});
