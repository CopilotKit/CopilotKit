import { describe, it, expect } from "vitest";
import { renderTelegram } from "../telegram.js";

const text = (value: string) => ({ type: "text", props: { value } });
const node = (
  type: string,
  props: Record<string, unknown>,
  children?: unknown,
) => ({ type, props: { ...props, ...(children ? { children } : {}) } });

describe("renderTelegram", () => {
  it("renders a header as bold", () => {
    const out = renderTelegram([node("header", {}, text("Status"))] as any);
    expect(out.parseMode).toBe("HTML");
    expect(out.text).toContain("<b>Status</b>");
  });
  // ── Regression: Bug 1 — header text must be HTML-escaped ──
  it("escapes < > & in header text (no tag injection, valid entities)", () => {
    const out = renderTelegram([
      node("header", {}, text("a < b & c <script>")),
    ] as any);
    // The escaped entities must be present...
    expect(out.text).toContain("&lt;");
    expect(out.text).toContain("&amp;");
    // ...wrapped in the bold tag.
    expect(out.text).toContain("<b>");
    expect(out.text).toContain("</b>");
    // ...and no raw "<" from the header content leaked through (the only raw
    // angle brackets must be the <b></b> wrapper itself).
    const withoutWrapper = out.text.replace(/<\/?b>/g, "");
    expect(withoutWrapper).not.toMatch(/</);
    // The injected tag name must NOT appear as a live tag.
    expect(out.text).not.toContain("<script>");
  });

  it("renders an actions button into the inline keyboard with its minted id", () => {
    const onClick = Object.assign(() => {}, { id: "ck:abc123" });
    const out = renderTelegram([
      node("actions", {}, [node("button", { onClick }, text("Approve"))]),
    ] as any);
    expect(out.inlineKeyboard?.[0]?.[0]).toEqual({
      text: "Approve",
      callbackData: "ck:abc123",
    });
  });
  it("renders a url button", () => {
    const out = renderTelegram([
      node("actions", {}, [
        node("button", { url: "https://x.io" }, text("Open")),
      ]),
    ] as any);
    expect(out.inlineKeyboard?.[0]?.[0]).toEqual({
      text: "Open",
      url: "https://x.io",
    });
  });
  it("degrades oversized callback_data button (skips it, does not throw)", () => {
    // One button with a minted id that fits (≤64 bytes), one oversized.
    const okClick = Object.assign(() => {}, { id: "ck:abc123" });
    const bigClick = Object.assign(() => {}, { id: "ck:" + "x".repeat(70) });
    const out = renderTelegram([
      node("actions", {}, [
        node("button", { onClick: okClick }, text("OK")),
        node("button", { onClick: bigClick }, text("Oversized")),
      ]),
    ] as any);
    // Must not throw, must keep the valid button, must omit the oversized one.
    expect(out.inlineKeyboard).toBeDefined();
    const allButtons = out.inlineKeyboard!.flat();
    expect(allButtons).toHaveLength(1);
    expect(allButtons[0]).toEqual({ text: "OK", callbackData: "ck:abc123" });
  });
  it("collects images into photos", () => {
    const out = renderTelegram([node("image", { url: "u", alt: "a" })] as any);
    expect(out.photos).toEqual([{ url: "u", caption: "a" }]);
  });
  it("ignores unknown nodes (total renderer)", () => {
    expect(() => renderTelegram([node("mystery", {})] as any)).not.toThrow();
  });

  // ── Regression: Bug 1 — HTML truncation must not split tags or entities ──
  it("truncates very long text without producing dangling < or & fragments", () => {
    // 5000 chars of "a" far exceeds the 4096-char messageText limit.
    const longText = "a".repeat(5000);
    const out = renderTelegram([node("section", {}, text(longText))] as any);
    expect(out.text.length).toBeLessThanOrEqual(4096);
    // No dangling open-angle (unfinished tag) at the end.
    expect(out.text).not.toMatch(/<[^>]*$/);
    // No dangling entity fragment (& not followed by semicolon before end).
    expect(out.text).not.toMatch(/&(?![a-zA-Z]+;|#\d+;|#x[\da-fA-F]+;)[^;]*$/);
  });

  it("truncates markdown with HTML tags without splitting mid-tag", () => {
    // Markdown that produces HTML tags; padded to exceed 4096 chars.
    // The key invariant is no dangling/unbalanced tags — the HTML byte count
    // may exceed 4096 (raw was bounded; markup adds overhead), but tags must
    // be complete.
    const mdText = "**bold text** " + "x".repeat(4200);
    const out = renderTelegram([node("markdown", {}, text(mdText))] as any);
    // No dangling open-angle (unfinished tag) at the end.
    expect(out.text).not.toMatch(/<[^>]*$/);
    // No dangling entity fragment.
    expect(out.text).not.toMatch(/&(?![a-zA-Z]+;|#\d+;|#x[\da-fA-F]+;)[^;]*$/);
  });

  // ── Regression: Bug 2 — select with oversized callback_data degrades ──
  it("degrades oversized select option (skips it, does not throw)", () => {
    const options = [
      { label: "Good", value: "ok" },
      { label: "Oversized", value: "x".repeat(100) },
    ];
    const out = renderTelegram([node("select", { options })] as any);
    const allButtons = (out.inlineKeyboard ?? []).flat();
    // Should keep the valid option and drop the oversized one.
    expect(
      allButtons.some((b) => b.callbackData === JSON.stringify("ok")),
    ).toBe(true);
    expect(allButtons.some((b) => (b.callbackData ?? "").length > 64)).toBe(
      false,
    );
  });

  // ── Regression: Bug 3 — caption must be capped at 1024 chars ──
  it("caps image caption at 1024 chars", () => {
    const longAlt = "c".repeat(2000);
    const out = renderTelegram([
      node("image", { url: "https://x.io/img.jpg", alt: longAlt }),
    ] as any);
    const caption = out.photos?.[0]?.caption;
    expect(caption).toBeDefined();
    expect(caption!.length).toBeLessThanOrEqual(1024);
  });

  // ── Regression: truncation marker preserved when cut falls on a line
  //    boundary; reconstructed text stays within the messageText budget. ──
  it("preserves the ellipsis marker and stays within budget when truncation lands on a line boundary", () => {
    // Build many short lines so the 4096-char raw budget is exhausted exactly
    // at a "\n" boundary between full lines (no partial line emitted).
    // Each "section" is one entry joined by "\n". 100-char lines × N lines.
    const line = "a".repeat(99); // 99 chars + "\n" separator = 100 per entry
    const nodes = Array.from({ length: 60 }, () => ({
      type: "section",
      props: { children: text(line) },
    }));
    const out = renderTelegram(nodes as any);
    expect(out.text.length).toBeLessThanOrEqual(4096);
    // Content was dropped → the truncation marker must be present.
    expect(out.text.endsWith("…")).toBe(true);
  });

  // ── Regression: Bug 3 — truncated last line stays well-formed (no
  //    mismatched tags) for a field line `<b>Label</b> value`. ──
  it("keeps the truncated last line well-formed for a field line", () => {
    // First entry fills most of the budget; the field line is partially cut so
    // reRenderRawLine handles the partial last line. The field html is
    // `<b>Label</b> value`, which is NOT a single-tag wrapper, so the wrapper
    // regex must NOT (mis)match it as <b>…</b>.
    const filler = "b".repeat(4080);
    const fieldValue = "x".repeat(200);
    const out = renderTelegram([
      { type: "section", props: { children: text(filler) } },
      {
        type: "field",
        props: { label: "Label", children: text(fieldValue) },
      },
    ] as any);
    // Every opening tag must have a matching close: count balanced b/i tags.
    const opens = (out.text.match(/<(b|i|u|s|pre|code)>/g) ?? []).length;
    const closes = (out.text.match(/<\/(b|i|u|s|pre|code)>/g) ?? []).length;
    expect(opens).toBe(closes);
    // No mismatched wrapper like <b>…</i>.
    expect(out.text).not.toMatch(/<b>[^<]*<\/i>/);
    expect(out.text).not.toMatch(/<i>[^<]*<\/b>/);
    // No dangling open-angle.
    expect(out.text).not.toMatch(/<[^>]*$/);
  });

  // ── Regression: Bug 4 — total buttons across multiple action blocks must
  //    not exceed buttonsPerMessage (100). ──
  it("caps total buttons across multiple action blocks at the keyboard limit", () => {
    const makeButtons = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const onClick = Object.assign(() => {}, { id: `${prefix}:${i}` });
        return node("button", { onClick }, text(`${prefix}-${i}`));
      });
    const out = renderTelegram([
      node("actions", {}, makeButtons("a", 70)),
      node("actions", {}, makeButtons("b", 70)),
    ] as any);
    const total = (out.inlineKeyboard ?? []).reduce(
      (s, row) => s + row.length,
      0,
    );
    expect(total).toBeLessThanOrEqual(100);
  });

  // ── Regression: Bug 2 — emitted HTML must never exceed messageText (4096),
  //    even when entity expansion blows up the raw text (e.g. & → &amp;, 5x). ──
  it("bounds final HTML length to 4096 under heavy entity expansion", () => {
    // 4096 raw "&" each escape to "&amp;" (5x). Raw fits the budget but the
    // naive HTML would be ~20k chars and Telegram would reject "message is too
    // long". The renderer must shrink the raw budget until the HTML fits.
    const heavy = "&".repeat(4096);
    const out = renderTelegram([node("section", {}, text(heavy))] as any);
    expect(out.text.length).toBeLessThanOrEqual(4096);
    // Well-formed: no dangling open-angle, no split entity at the end.
    expect(out.text).not.toMatch(/<[^>]*$/);
    expect(out.text).not.toMatch(/&(?![a-zA-Z]+;|#\d+;|#x[\da-fA-F]+;)[^;]*$/);
    // The content that survived must be valid &amp; entities (no bare "&xxx"
    // fragment, no half "&am").
    expect(out.text).not.toMatch(/&amp(?!;)/);
  });

  it("bounds final HTML length even when a header full of & nearly fills budget", () => {
    // Header is capped at 256 raw chars, but combine many sections of & so the
    // joined HTML overshoots and the iterative shrink must engage.
    const block = "&".repeat(500);
    const nodes = Array.from({ length: 10 }, () => ({
      type: "section",
      props: { children: text(block) },
    }));
    const out = renderTelegram(nodes as any);
    expect(out.text.length).toBeLessThanOrEqual(4096);
    expect(out.text).not.toMatch(/<[^>]*$/);
    expect(out.text).not.toMatch(/&(?![a-zA-Z]+;|#\d+;|#x[\da-fA-F]+;)[^;]*$/);
  });

  // ── Regression: Bug 3 — a truncated context line must stay a single balanced
  //    <i>…</i> (re-wrapped from the stored wrapper kind, not regex-detected). ──
  it("re-wraps a truncated context line as a single balanced <i>…</i>", () => {
    // Filler fills part of the budget; the context line is partially cut so it
    // becomes the truncated last line handled by the structural re-wrap. The
    // context content is long enough that the iterative HTML-length shrink keeps
    // the cut inside the context span (never dropping it entirely).
    const filler = "b".repeat(3000);
    const ctx = "c".repeat(2000);
    const out = renderTelegram([
      { type: "section", props: { children: text(filler) } },
      { type: "context", props: { children: text(ctx) } },
    ] as any);
    expect(out.text.length).toBeLessThanOrEqual(4096);
    // Exactly one <i> open and one </i> close (balanced, single span).
    const iOpens = (out.text.match(/<i>/g) ?? []).length;
    const iCloses = (out.text.match(/<\/i>/g) ?? []).length;
    expect(iOpens).toBe(1);
    expect(iCloses).toBe(1);
    // The italic span must contain the truncated context content and close
    // before the ellipsis marker.
    expect(out.text).toMatch(/<i>c+<\/i>…$/);
  });
});
