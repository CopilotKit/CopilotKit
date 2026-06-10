import { describe, it, expect } from "vitest";
import {
  processPartialHtml,
  extractCompleteStyles,
} from "../processPartialHtml";

describe("processPartialHtml", () => {
  it("returns empty string for empty input", () => {
    expect(processPartialHtml("")).toBe("");
  });

  it("strips incomplete tag at end", () => {
    expect(processPartialHtml('<div>Hello<span class="fo')).toBe("<div>Hello");
  });

  it("hoists a complete <head>-element style and strips it from the body", () => {
    // A <style> inside a complete <head>…</head> element is hoisted into the
    // preview <head> by extractCompleteStyles, so processPartialHtml removes it
    // (the whole head element is stripped) — never both, never neither.
    const input =
      "<head><style>.foo { color: red; }</style></head><body><div>Hello</div><p>World</p></body>";
    expect(processPartialHtml(input)).toBe("<div>Hello</div><p>World</p>");
  });

  it("keeps a top-level pre-<body> style in the body (final-document parity)", () => {
    // No <head> element wraps this style, so it is NOT hoisted. assembleDocument
    // leaves a top-level pre-<body> style in the body region (after the head css
    // in document order), so the preview body must keep it too.
    const input =
      "<style>.foo { color: red; }</style><body><div>Hello</div><p>World</p></body>";
    expect(processPartialHtml(input)).toBe(
      "<style>.foo { color: red; }</style><div>Hello</div><p>World</p>",
    );
  });

  it("keeps a complete <style> block in the body region (cascade parity)", () => {
    // A complete <style> INSIDE the body stays in place — browsers apply
    // <style> anywhere and the final document (assembleDocument) likewise keeps
    // body-region styles in the body (after the head css in document order), so
    // the preview must not hoist it to the head.
    const input =
      "<body><div>Hello</div><style>.foo { color: red; }</style><p>World</p></body>";
    expect(processPartialHtml(input)).toBe(
      "<div>Hello</div><style>.foo { color: red; }</style><p>World</p>",
    );
  });

  it("keeps a complete <style> block when there is no <body> (whole string is body region)", () => {
    // With no <body> tag the entire string is the body region, so a complete
    // <style> is kept exactly where it appears (and extractCompleteStyles
    // hoists nothing — there is no <head> element).
    const input =
      "<div>Hello</div><style>.foo { color: red; }</style><p>World</p>";
    expect(processPartialHtml(input)).toBe(input);
  });

  it("strips complete <script> blocks", () => {
    const input = '<div>Hello</div><script>alert("hi")</script><p>World</p>';
    expect(processPartialHtml(input)).toBe("<div>Hello</div><p>World</p>");
  });

  it("strips incomplete <style> block", () => {
    const input = "<div>Hello</div><style>.foo { color:";
    expect(processPartialHtml(input)).toBe("<div>Hello</div>");
  });

  it("strips incomplete <script> block", () => {
    const input = '<div>Hello</div><script>const x = "val';
    expect(processPartialHtml(input)).toBe("<div>Hello</div>");
  });

  it("strips incomplete HTML entities", () => {
    expect(processPartialHtml("<p>Hello &amp")).toBe("<p>Hello ");
    expect(processPartialHtml("<p>Hello &#123")).toBe("<p>Hello ");
  });

  it("preserves complete entities", () => {
    expect(processPartialHtml("<p>Hello &amp; World</p>")).toBe(
      "<p>Hello &amp; World</p>",
    );
  });

  it("extracts body content from full HTML document", () => {
    const input =
      "<html><head><title>Test</title></head><body><p>Content</p></body></html>";
    expect(processPartialHtml(input)).toBe("<p>Content</p>");
  });

  it("handles <body> with attributes", () => {
    const input = '<body class="dark"><p>Content</p></body>';
    expect(processPartialHtml(input)).toBe("<p>Content</p>");
  });

  it("handles no <body> tag — returns full processed string", () => {
    const input = "<div><p>Just content</p></div>";
    expect(processPartialHtml(input)).toBe("<div><p>Just content</p></div>");
  });

  it("handles combined edge cases: full document with styles, scripts, and incomplete tag", () => {
    const input =
      '<html><head><style>body { margin: 0; }</style></head><body><div>Hello</div><script>console.log("x")</script><p>World</p><span class="in';
    expect(processPartialHtml(input)).toBe("<div>Hello</div><p>World</p>");
  });

  it("handles body content with incomplete style at end", () => {
    const input = "<body><div>Content</div><style>.partial {";
    expect(processPartialHtml(input)).toBe("<div>Content</div>");
  });
});

describe("extractCompleteStyles", () => {
  it("returns empty string for no styles", () => {
    expect(extractCompleteStyles("<div>Hello</div>")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(extractCompleteStyles("")).toBe("");
  });

  it("hoists a style inside a complete <head> element", () => {
    const input =
      "<head><style>body { margin: 0; }</style></head><body><p>Hi</p></body>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>body { margin: 0; }</style>",
    );
  });

  it("hoists multiple styles inside a complete <head> element", () => {
    const input =
      "<head><style>a{}</style><style>b{}</style></head><body></body>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>a{}</style><style>b{}</style>",
    );
  });

  it("does NOT hoist a top-level pre-<body> style (final-document parity)", () => {
    // No <head> element, so the style is body-region in the final document and
    // must NOT be hoisted (it stays in the preview body via processPartialHtml).
    const input =
      "<style>.foo { color: red; }</style><body><p>World</p></body>";
    expect(extractCompleteStyles(input)).toBe("");
  });

  it("does NOT hoist multiple top-level pre-<body> styles", () => {
    const input =
      "<style>a{}</style><div>X</div><style>b{}</style><body></body>";
    expect(extractCompleteStyles(input)).toBe("");
  });

  it("does NOT hoist when the only complete style is top-level pre-<body>", () => {
    // An incomplete trailing style is never hoisted; the complete one here is
    // top-level (no <head> element), so nothing is hoisted.
    const input = "<style>.complete{}</style><style>.incomplete {<body></body>";
    expect(extractCompleteStyles(input)).toBe("");
  });

  it("does NOT extract styles from the body region (left in place for cascade parity)", () => {
    // A complete <style> inside the body must stay in the body — hoisting it
    // would flip its cascade position at the preview→final swap.
    const input =
      "<body><div>Hi</div><style>.foo { color: red; }</style></body>";
    expect(extractCompleteStyles(input)).toBe("");
  });

  it("hoists only the head-element style, leaving the body-region style behind", () => {
    // Mixed document: the head-element style is hoisted, the body style is not.
    const input =
      "<head><style>.head { color: red; }</style></head><body><style>.body { color: blue; }</style></body>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>.head { color: red; }</style>",
    );
  });

  it("hoists nothing when there is no <body> tag (whole string is body region)", () => {
    const input = "<style>.foo { color: red; }</style><div>Hi</div>";
    expect(extractCompleteStyles(input)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Review finding-cluster: the two functions must derive head/body boundaries
// from ONE shared masked computation. Each case asserts on BOTH functions —
// every complete <style> is hoisted XOR retained (never both, never neither),
// no raw CSS text leaks into the body, and the body keeps exactly what the
// FINAL document (assembleDocument) renders in its body region.
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — shared boundary parity", () => {
  // Case A — RED pre-fix: a style in a complete <head> element with NO <body>
  // streamed yet was dropped from BOTH regions (extractCompleteStyles found no
  // <body> boundary so hoisted nothing; processPartialHtml stripped the whole
  // head block). NEW rule: hoist the head-element style; keep the trailing
  // top-level content in the body.
  it("A: head-element style with no <body> yet → hoisted, not dropped", () => {
    const input = "<head><style>.h{color:red}</style></head><div>content</div>";
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe("<style>.h{color:red}</style>"); // hoisted
    expect(body).toBe("<div>content</div>"); // NOT in body
    expect(body).not.toContain("<style"); // no duplicate / no leak
  });

  // Case B — RED pre-fix: a chunk ending mid-`<body` tag made
  // extractCompleteStyles see a phantom boundary (hoist) while processPartialHtml
  // stripped the incomplete trailing tag and kept the style — DOUBLE-INJECTED.
  // NEW rule: no <head> element ⇒ never hoist; keep the style in the body only.
  it("B: chunk ends mid-<body> tag → style kept in body only, not double-injected", () => {
    const input = '<style>.a{}</style><div>h</div><body class="x';
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe(""); // NOT hoisted (no head element)
    expect(body).toBe("<style>.a{}</style><div>h</div>"); // kept once in body
  });

  // Case C — RED pre-fix: a legal CSS token `content:"<body>"` split the style
  // mid-block in both functions; the raw CSS tail `"}</style>` leaked into the
  // preview body. NEW rule: masking hides the CSS token, the real <body> is
  // found, the complete style is kept intact in the body, no leak.
  it("C: <body> token inside CSS content → style intact in body, no raw CSS leak", () => {
    const input =
      '<style>div::before{content:"<body>"}</style><body><p>P</p></body>';
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe(""); // NOT hoisted (no head element)
    expect(body).toBe('<style>div::before{content:"<body>"}</style><p>P</p>');
    // No orphan CSS fragment: removing the complete style leaves clean markup.
    expect(body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/i, "")).toBe(
      "<p>P</p>",
    );
  });

  // Case C (comment variant) — same class: a `<body` token inside a CSS comment.
  it("C': <body> token inside a CSS comment → style intact in body, no leak", () => {
    const input =
      "<style>/* hide <body /> default */ .x{}</style><body><p>P</p></body>";
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe("");
    expect(body).toBe(
      "<style>/* hide <body /> default */ .x{}</style><p>P</p>",
    );
    expect(body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/i, "")).toBe(
      "<p>P</p>",
    );
  });

  // Case D — RED pre-fix: a <body> token nested inside a complete <head> block
  // made the two functions classify the trailing top-level `.s{}` differently →
  // dropped from BOTH. NEW rule: the head element is stripped wholesale (its
  // nested <body> token cannot fake the real boundary via masking), and the
  // top-level `.s{}` is body-region — kept in the body, not hoisted.
  it("D: <body> token nested in a <head> block → top-level style kept in body", () => {
    const input = "<head>x<body>y</head><style>.s{}</style><body>real</body>";
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe(""); // .s{} is top-level, not in a head element
    expect(body).toBe("<style>.s{}</style>real"); // kept in body, not dropped
  });

  // Case E — RED pre-fix: step 5's `/<body[^>]*>/i` (no word boundary) matched
  // `<bodyguard …>` and dropped the leading <div>. NEW rule: word-bounded
  // `/<body[\s>]/i` never matches `<bodyguard>`, so the whole input is body.
  it("E: <bodyguard> is not <body> → leading <div> retained", () => {
    const input = '<div>hi</div><bodyguard data-x="1">guarded</bodyguard>';
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe("");
    expect(body).toBe(input); // leading <div> kept; <bodyguard> untouched
    expect(body).toContain("<div>hi</div>");
  });

  // Case F — final-document parity: a top-level pre-<body> style stays in the
  // BODY region of the assembled document (after the head css), so the preview
  // body must keep it and the head payload must not.
  it("F: top-level pre-<body> style stays in the body (matches assembleDocument)", () => {
    const input = "<style>.head-style{}</style><body>BODYTEXT</body>";
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe(""); // NOT hoisted
    expect(body).toBe("<style>.head-style{}</style>BODYTEXT"); // kept in body
  });
});
