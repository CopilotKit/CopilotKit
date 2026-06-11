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
    // No <head> element wraps this style, so it is NOT hoisted. The final
    // document (ensureHead + injectCssIntoHtml) leaves a top-level pre-<body>
    // style in the body region (after the head css in document order), so the
    // preview body must keep it too.
    const input =
      "<style>.foo { color: red; }</style><body><div>Hello</div><p>World</p></body>";
    expect(processPartialHtml(input)).toBe(
      "<style>.foo { color: red; }</style><div>Hello</div><p>World</p>",
    );
  });

  it("keeps a complete <style> block in the body region (cascade parity)", () => {
    // A complete <style> INSIDE the body stays in place — browsers apply
    // <style> anywhere and the final document likewise keeps body-region styles
    // in the body (after the head css in document order), so the preview must
    // not hoist it to the head.
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
// FINAL document (ensureHead + injectCssIntoHtml) renders in its body region.
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

  // Case D — UPDATED to browser parity (the old pin asserted buggy behavior).
  // Input: `<head>x<body>y</head><style>.s{}</style><body>real</body>`. The old
  // pin expected `<style>.s{}</style>real` (the whole `<head>x<body>y</head>` was
  // treated as one head element and dropped, taking `x` and `y` with it — the
  // very Finding-1 over-greedy `</head>` pairing). jsdom (the oracle) shows the
  // head closes at the FIRST boundary, the flow TEXT `x`, so `x` (and the later
  // `y`) are body content and `.s{}` is body-region:
  //   new JSDOM("<head>x<body>y</head><style>.s{}</style><body>real</body>")
  //     .window.document.head.innerHTML === ""
  //     .window.document.body.innerHTML === "xy<style>.s{}</style>real"
  // The `<body>`/`</body>`/`</head>` tags are consumed as structure; `.s{}` is
  // never hoisted (no head element survives). The masking intent is unchanged —
  // a `<body>` inside CSS/a comment still cannot fake a boundary (see C/C'/M').
  it("D: text + nested body in the head region → head closes at the text, .s{} kept in body", () => {
    const input = "<head>x<body>y</head><style>.s{}</style><body>real</body>";
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe(""); // no head element survives ⇒ .s{} is body-region
    expect(body).toBe("xy<style>.s{}</style>real"); // browser parity (jsdom)
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
  it("F: top-level pre-<body> style stays in the body (matches final document)", () => {
    const input = "<style>.head-style{}</style><body>BODYTEXT</body>";
    const hoisted = extractCompleteStyles(input);
    const body = processPartialHtml(input);
    expect(hoisted).toBe(""); // NOT hoisted
    expect(body).toBe("<style>.head-style{}</style>BODYTEXT"); // kept in body
  });

  // Case G — quote-aware open-tag scan: a quoted `>` inside a <body> attribute
  // must not truncate the open tag early and leak attribute fragments.
  it("G: quoted > in a <body> attribute → no attribute fragments leak", () => {
    const input = '<body data-x="a>b"><p>hi</p></body>';
    const body = processPartialHtml(input);
    expect(body).toBe("<p>hi</p>");
    expect(body).not.toContain('b">');
  });
});

// ---------------------------------------------------------------------------
// HTML comments must be masked like style/script content: a tag-lookalike
// inside a complete comment is real comment text (never stripped, never a
// structural boundary), and an unterminated trailing comment must vanish
// (the final document's `-->` swallows the remainder). Each case asserts the
// never-both / never-neither invariant against the FINAL document's rendering.
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — HTML comment masking", () => {
  // RED pre-fix: maskBlockContent masked only style/script, so the <script>
  // inside the comment was stripped, gutting the comment.
  it("H: complete comment containing a <script> is preserved, not gutted", () => {
    const input =
      "<body><p>before</p><!-- <script>x</script> --><p>after</p></body>";
    expect(processPartialHtml(input)).toBe(
      "<p>before</p><!-- <script>x</script> --><p>after</p>",
    );
  });

  // RED pre-fix: the comment's <body> token was taken as the body boundary,
  // dropping the leading <div>.
  it("I: complete comment containing a <body> token is not a boundary", () => {
    const input = "<div>a</div><!-- <body> --><p>b</p>";
    expect(processPartialHtml(input)).toBe(
      "<div>a</div><!-- <body> --><p>b</p>",
    );
  });

  // A complete comment containing </body> must not fake the close boundary.
  it("I': complete comment containing </body> is not a close boundary", () => {
    const input = "<body><p>a</p><!-- </body> --><p>b</p></body>";
    expect(processPartialHtml(input)).toBe("<p>a</p><!-- </body> --><p>b</p>");
  });

  // Streaming case: an unterminated trailing comment must not fake structure and
  // must vanish from the preview body (consistent with the final document, where
  // the eventual `-->` comments out everything after `<!--`).
  it("J: unterminated trailing comment is dropped (no fake structure)", () => {
    expect(processPartialHtml("<div>a</div><!-- partial")).toBe("<div>a</div>");
    // …even when the partial comment contains a `>` (so step 2's bare
    // incomplete-tag strip cannot catch it).
    expect(processPartialHtml("<div>a</div><!-- partial <span> more")).toBe(
      "<div>a</div>",
    );
  });

  // Invariant under an unterminated comment: a COMPLETE style before it is kept
  // in the body exactly once; a complete-looking style INSIDE the unterminated
  // comment is neither hoisted nor leaked (the final document comments it out).
  it("K: complete style before an unterminated comment → kept once, inner style not hoisted/leaked", () => {
    const input = "<style>.a{}</style><div>x</div><!-- <style>.b{}</style";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(body).toBe("<style>.a{}</style><div>x</div>");
    expect(hoisted).toBe(""); // .a is top-level (no head); .b is inside the comment
    expect(body).not.toContain(".b"); // inner style text did not leak
  });
});

// ---------------------------------------------------------------------------
// Unclosed <head> implicit close: the preview must agree with the final
// document's effective rendering. A browser closes <head> at the FIRST of a
// <body> token, a flow (non-head-permitted) start tag, or non-whitespace text —
// leaving the in-head css in the head and everything from the boundary onward in
// the body. Content must never vanish. jsdom (the browser-equivalent parser) is
// the oracle for every expectation here:
//   new JSDOM("<head><style>.a{}</style><body><p>hi</p></body>")…
//     head.innerHTML === "<style>.a{}</style>", body.innerHTML === "<p>hi</p>"
//   new JSDOM("<head><style>.a{}</style><p>x</p>")…
//     head.innerHTML === "<style>.a{}</style>", body.innerHTML === "<p>x</p>"
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — unclosed <head> implicit close", () => {
  // RED pre-fix: extractCompleteStyles hoisted nothing (no complete head
  // element) AND step 3 stripped the unclosed <head> to end-of-string →
  // preview rendered empty while the final document renders the content.
  it("L: unclosed <head> + <body> + content → style hoisted, body content kept (not dropped)", () => {
    const input = "<head><style>.a{color:red}</style><body><p>hi</p></body>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{color:red}</style>"); // hoisted (in-head)
    expect(body).toBe("<p>hi</p>"); // body content preserved
    expect(body).not.toContain("<style"); // not double-injected
  });

  // The implicit close also strips the head region's non-style markup from the
  // body, keeping only the body content (parity with the final document). Title
  // text content does NOT trigger the flow/text close — title is head-permitted
  // RCDATA, so the scan skips its inner text to </title>.
  it("L': unclosed <head> with title + style before <body> → only body content remains", () => {
    const input =
      "<head><title>t</title><style>.a{}</style><body><p>x</p></body>";
    expect(processPartialHtml(input)).toBe("<p>x</p>");
    expect(extractCompleteStyles(input)).toBe("<style>.a{}</style>");
  });

  // Pin (re-scoped): an unclosed <head> whose region so far contains ONLY
  // head-permitted content and has NO body/flow/text boundary is genuinely still
  // streaming its own head — it is stripped (preview empty until more streams in,
  // self-correcting). NOTE: a browser would already hoist `.a` (jsdom body ""),
  // but mid-stream we defer to "" rather than flash a partial head. This pin is
  // kept stable by the streaming guard in findHeadContentEnd (no boundary ⇒ null
  // ⇒ no span ⇒ unterminated-head strip).
  it("M: unclosed <head>, head-permitted content only, NO body/flow/text → stripped (pinned)", () => {
    const input = "<head><style>.a{}</style>";
    expect(processPartialHtml(input)).toBe("");
    expect(extractCompleteStyles(input)).toBe("");
  });

  // Pin (re-scoped): a <body> token inside a style/comment within an unclosed
  // head must NOT be taken as the implicit close (masking guards it). With only
  // head-permitted content and NO real body/flow/text boundary, the head is still
  // streaming ⇒ stripped. jsdom agrees the body is "" here.
  it("M': <body> token inside CSS in an unclosed head is not the implicit close (still streaming → stripped)", () => {
    const input = '<head><style>.a{content:"<body>"}</style>';
    // No REAL boundary ⇒ unclosed head still streaming ⇒ stripped (pinned).
    expect(processPartialHtml(input)).toBe("");
    expect(extractCompleteStyles(input)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// FINDING 1 — the </head> pairing must not cross a <body> boundary. The old
// scan paired a <head> open with the FIRST </head> ANYWHERE after it, even past
// a <body> token, so body content was swallowed into the "head element" and the
// preview went BLANK. A browser closes the head at the implicit <body> boundary
// FIRST; a </head> after <body> is a stray close. jsdom is the oracle:
//   "<head><style>.a{}</style><body><p>hi</p></head>" → body "<p>hi</p>"
//   "<head><body><style>.b{}</style></head>"          → body "<style>.b{}</style>"
//   "<head><style>.a{}</style><body>x</body><head><style>.b{}</style></head>"
//                              → hoist ".a" only, body "x<style>.b{}</style>"
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — FINDING 1: </head> pairing bounded by <body>", () => {
  // RED pre-fix: body "" (everything through the trailing </head> read as one
  // head element). jsdom: head "<style>.a{}</style>", body "<p>hi</p>".
  it("F1.a: <head>…</head> spanning past <body> → in-head style hoisted, body content kept", () => {
    const input = "<head><style>.a{}</style><body><p>hi</p></head>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{}</style>"); // implicit close at <body>
    expect(body).toBe("<p>hi</p>"); // not swallowed into the head element
    expect(body).not.toContain("<style"); // hoisted XOR kept
    expect(body).not.toContain("</head>"); // stray close not leaked
  });

  // RED pre-fix: the style after the implicit <body> close was hoisted (head
  // span crossed <body>). jsdom keeps it in the body: head "", body
  // "<style>.b{}</style>".
  it("F1.b: <head><body><style> → style is body-region (not hoisted), kept in body", () => {
    const input = "<head><body><style>.b{}</style></head>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe(""); // .b is after the implicit <body> close
    expect(body).toBe("<style>.b{}</style>"); // kept in body, stray head tags dropped
  });

  // RED pre-fix: BOTH styles hoisted (head span ran to the trailing </head>).
  // jsdom hoists only .a; .b (in the body-region second head) stays in the body.
  it("F1.c: head, body, then a second head → only the first in-head style hoisted", () => {
    const input =
      "<head><style>.a{}</style><body>x</body><head><style>.b{}</style></head>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{}</style>"); // only the pre-<body> head
    expect(body).toBe("x<style>.b{}</style>"); // body keeps x + the late style; stray head tags dropped
  });
});

// ---------------------------------------------------------------------------
// FINDING 2 — a <head> nested inside the body region is body content, never a
// head element; its style must NOT be hoisted (a cascade flip at the swap), and
// the stray <head>/</head> tags are dropped while the content is kept. jsdom:
//   "<head><style>.h{}</style></head><body><head><style>.b{}</style></head><p>x</p></body>"
//     → head "<style>.h{}</style>", body "<style>.b{}</style><p>x</p>"
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — FINDING 2: nested <head> in body is body content", () => {
  // RED pre-fix: both .h and .b hoisted. jsdom hoists only .h; .b stays in body.
  it("F2.a: <head> inside <body> → only the real head's style hoisted, nested kept in body", () => {
    const input =
      "<head><style>.h{}</style></head><body><head><style>.b{}</style></head><p>x</p></body>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.h{}</style>"); // only the pre-<body> head element
    expect(body).toBe("<style>.b{}</style><p>x</p>"); // nested head tags dropped, content kept
    expect(body).not.toContain("<head>"); // stray nested head open dropped
    expect(body).not.toContain("</head>"); // stray nested head close dropped
  });
});

// ---------------------------------------------------------------------------
// FINDING 3 — a stray standalone </head> (unmatched by a counted head element)
// must be stripped mask-aware, never leaked into the preview body as literal
// text. jsdom:
//   "<head>z</head><body><div>real</div></body></head>" → body "z<div>real</div>"
//   "<head><style>.a{}</style></head><body><div>real</div></body></head>"
//     → head "<style>.a{}</style>", body "<div>real</div>"
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — FINDING 3: stray </head> stripped, not leaked", () => {
  // RED pre-fix: body "<div>real</div></head>" (the trailing </head> leaked).
  // jsdom: body "z<div>real</div>" (z is flow text → head closes before it).
  it("F3.a: trailing stray </head> after the body is stripped (text in head is body content)", () => {
    const input = "<head>z</head><body><div>real</div></body></head>";
    const body = processPartialHtml(input);
    expect(body).toBe("z<div>real</div>");
    expect(body).not.toContain("</head>"); // no literal close-tag leak
  });

  // RED pre-fix: body "<div>real</div></head>". jsdom: head "<style>.a{}</style>",
  // body "<div>real</div>".
  it("F3.b: in-head style hoisted, trailing stray </head> stripped from the body", () => {
    const input =
      "<head><style>.a{}</style></head><body><div>real</div></body></head>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{}</style>");
    expect(body).toBe("<div>real</div>");
    expect(body).not.toContain("</head>");
  });
});

// ---------------------------------------------------------------------------
// FINDING 4 — a browser opens the body once; a SECOND <body> open token is
// dropped and its following markup stays in the one body. Step 5 must remove
// EVERY <body> open, not just the first. jsdom:
//   "<body><p>a</p><body><p>b</p>" → body "<p>a</p><p>b</p>"
// ---------------------------------------------------------------------------
describe("processPartialHtml — FINDING 4: every <body> open removed (duplicate not leaked)", () => {
  // RED pre-fix: body "<p>a</p><body><p>b</p>" (the second <body> leaked as text).
  it("F4.a: duplicate <body> open is removed, both contents kept in the body", () => {
    const input = "<body><p>a</p><body><p>b</p>";
    const body = processPartialHtml(input);
    expect(body).toBe("<p>a</p><p>b</p>");
    expect(body).not.toContain("<body"); // no duplicate open-tag leak
  });

  // A duplicate <body> with attributes is also dropped (quote-aware open scan).
  it("F4.b: duplicate <body> with attributes is removed, no attribute fragments leak", () => {
    const input = '<body class="x"><p>a</p><body data-y="b>c"><p>b</p>';
    const body = processPartialHtml(input);
    expect(body).toBe("<p>a</p><p>b</p>");
    expect(body).not.toContain("<body");
    expect(body).not.toContain('c">'); // quoted > did not truncate the open tag
  });
});

// ---------------------------------------------------------------------------
// FINDING 5 — the implicit head close fires at the first NON-HEAD content, not
// only at a <body> token: a flow (non-head-permitted) start tag, or the first
// non-whitespace text character. Otherwise an unclosed head with flow content
// and no <body> would strip to end-of-string and render BLANK while the browser
// renders the flow content. jsdom is the oracle:
//   "<head><style>.a{}</style><p>x</p>"     → head "<style>.a{}</style>", body "<p>x</p>"
//   "<head><style>.a{}</style>plaintext"    → head "<style>.a{}</style>", body "plaintext"
//   "<head><style>.a{}</style><div>flow</div><style>.b{}</style>"
//                            → head "<style>.a{}</style>", body "<div>flow</div><style>.b{}</style>"
// The streaming guard (head-permitted-only content with no boundary, or a
// trailing incomplete tag) is pinned by case M / M' above.
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — FINDING 5: implicit close at flow / text", () => {
  // RED pre-fix: hoist "" AND body "" (unclosed head stripped to end-of-string).
  // jsdom hoists .a and renders <p>x</p>.
  it("F5.a: unclosed <head> + style + flow tag (no <body>) → style hoisted, flow kept", () => {
    const input = "<head><style>.a{}</style><p>x</p>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{}</style>"); // implicit close at <p>
    expect(body).toBe("<p>x</p>"); // flow content kept, not stripped
    expect(body).not.toContain("<style");
  });

  // RED pre-fix: hoist "" AND body "". jsdom: head ".a", body "plaintext"
  // (non-whitespace text closes the head).
  it("F5.b: unclosed <head> + style + bare text (no <body>) → style hoisted, text kept", () => {
    const input = "<head><style>.a{}</style>plaintext";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{}</style>"); // implicit close at the text
    expect(body).toBe("plaintext");
  });

  // RED pre-fix: hoist "" AND body "". jsdom hoists only the pre-flow .a; the
  // post-flow .b is body-region.
  it("F5.c: flow tag splits head/body → only the pre-flow style hoisted, rest in body", () => {
    const input = "<head><style>.a{}</style><div>flow</div><style>.b{}</style>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{}</style>"); // pre-flow, in head
    expect(body).toBe("<div>flow</div><style>.b{}</style>"); // post-flow, in body
  });

  // Leading whitespace inside the head does NOT close it; the style after the
  // whitespace is still in-head. jsdom: head "...<style>.a{}</style>...", body "<p>x</p>".
  it("F5.d: whitespace in head is not flow content; style stays in head", () => {
    const input = "<head>   <style>.a{}</style>   <p>x</p>";
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe("<style>.a{}</style>"); // whitespace did not close the head
    expect(processPartialHtml(input)).toBe("<p>x</p>");
  });

  // A trailing INCOMPLETE tag prefix (`<ti`) is indeterminate mid-stream — the
  // head must NOT close on it. With only head-permitted content + an incomplete
  // tail, the head is still streaming ⇒ stripped (self-corrects next chunk).
  it("F5.e: trailing incomplete tag does not trigger the implicit close (still streaming → stripped)", () => {
    const input = "<head><style>.a{}</style><ti";
    expect(processPartialHtml(input)).toBe("");
    expect(extractCompleteStyles(input)).toBe("");
  });

  // A meta (head-permitted void) followed by flow closes the head at the flow
  // tag. jsdom: head "<meta charset=...>", body "<h1>title</h1>".
  it("F5.f: head-permitted void tag then flow → flow content kept in body", () => {
    const input = "<head><meta charset='utf-8'><h1>title</h1>";
    expect(processPartialHtml(input)).toBe("<h1>title</h1>");
    expect(extractCompleteStyles(input)).toBe(""); // no styles
  });
});

// ---------------------------------------------------------------------------
// The <html> wrapper open tag must be stripped wherever it appears (not only
// when leading), mask-aware and quote-aware, so a prefixed wrapper does not
// leak the tag into the preview body.
// ---------------------------------------------------------------------------
describe("processPartialHtml — tolerant <html> wrapper strip", () => {
  // RED pre-fix: only a LEADING <html> was stripped (`/^<html\b[^>]*>/i`), so a
  // prefixed wrapper survived into the preview body.
  it("N: <html> with a text prefix → wrapper stripped, surrounding content kept", () => {
    const input = "text<html><body><p>x</p></body>";
    expect(processPartialHtml(input)).toBe("text<p>x</p>");
  });

  it("N': leading <html> still stripped (existing behavior preserved)", () => {
    const input = "<html><body><p>x</p></body></html>";
    expect(processPartialHtml(input)).toBe("<p>x</p>");
  });

  // Word-bounded: <htmlfoo> is not the html wrapper.
  it("N'': <htmlfoo> is not <html> → left intact", () => {
    const input = "<htmlfoo>kept</htmlfoo>";
    expect(processPartialHtml(input)).toBe("<htmlfoo>kept</htmlfoo>");
  });

  // Masked search: an <html> token inside a surviving style block cannot fake
  // the wrapper strip.
  it("N''': <html> token inside CSS content cannot fake the wrapper strip", () => {
    const input = '<style>.a{content:"<html>"}</style><div>x</div>';
    expect(processPartialHtml(input)).toBe(
      '<style>.a{content:"<html>"}</style><div>x</div>',
    );
  });

  // Close-tag analogs of N''' — the trailing </html> strip must also run on a
  // MASKED string (like every other structural op in the module), so a </html>
  // token inside SURVIVING body content is never deleted.
  //
  // RED pre-fix: the final `result.replace(/<\/html>/gi, "")` ran on the UNMASKED
  // result, so a </html> token inside CSS content was deleted, emptying it.
  it("N'''': </html> token inside CSS content cannot fake the wrapper strip", () => {
    const input =
      '<div>x</div><style>.a::before{content:"</html>"}</style><div>y</div>';
    expect(processPartialHtml(input)).toBe(
      '<div>x</div><style>.a::before{content:"</html>"}</style><div>y</div>',
    );
  });

  // RED pre-fix: a </html> token inside a complete comment's text was deleted.
  it("N''''': </html> token inside a complete comment is preserved", () => {
    const input = "<div>x</div><!-- ex </html> --><div>y</div>";
    expect(processPartialHtml(input)).toBe(
      "<div>x</div><!-- ex </html> --><div>y</div>",
    );
  });

  // RED pre-fix: a </html> token inside a <style> open-tag attribute value was
  // deleted (the attribute is blanked in the mask, so masked search skips it).
  it("N'''''': </html> token in a <style> attribute value is preserved", () => {
    const input = '<style data-note="</html>">.a{}</style>';
    expect(processPartialHtml(input)).toBe(
      '<style data-note="</html>">.a{}</style>',
    );
  });
});

// ---------------------------------------------------------------------------
// maskBlockContent open-tag end scan must be quote-aware: a quoted `>` in a
// style/script open tag must not mis-locate the content boundary and leave the
// real CSS unmasked, where a <body>/<html> token could fake a boundary.
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — quote-aware style open tag", () => {
  // RED pre-fix: maskBlockContent used full.indexOf(">"), so the quoted `>` in
  // `data-x="a>b"` mis-located the content start, leaving `b">…` and the CSS
  // unmasked — the unmasked <body> token then faked a body boundary.
  it("O: quoted > in a <style> open tag → <body> token in its CSS cannot fake a boundary", () => {
    const input =
      '<style data-x="a>b">.foo{content:"<body>"}</style><div>real</div>';
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    // The complete style stays intact in the body; <div>real</div> is kept (the
    // <body> token inside the CSS did not split anything off as a boundary).
    expect(body).toBe(
      '<style data-x="a>b">.foo{content:"<body>"}</style><div>real</div>',
    );
    expect(hoisted).toBe("");
    // Removing the complete style leaves clean markup — no orphan CSS fragment.
    expect(body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/i, "")).toBe(
      "<div>real</div>",
    );
  });

  // Same hazard with </body> in the CSS and a quoted `>` in the open tag.
  it("O': quoted > in a <style> open tag → </body> token in its CSS cannot fake a close", () => {
    const input =
      '<body><style data-x="a>b">.foo{content:"</body>"}</style><p>p</p></body>';
    expect(processPartialHtml(input)).toBe(
      '<style data-x="a>b">.foo{content:"</body>"}</style><p>p</p>',
    );
  });

  // RED pre-fix: the unterminated-block strip ran on the UNMASKED string, so a
  // `<head>` token inside a complete style's ATTRIBUTE value was matched as an
  // unterminated trailing <head> and the document was truncated to it. The strip
  // now measures on a masked copy (attribute values blanked), so the complete
  // style survives intact.
  it("P: <head> token in a <style> attribute value does not trigger the unterminated-block strip", () => {
    const input = '<style data-y="<head>">.foo{}</style><div>d</div>';
    expect(processPartialHtml(input)).toBe(
      '<style data-y="<head>">.foo{}</style><div>d</div>',
    );
  });

  // Same class for a `</body>` token in an attribute value (no fake close).
  it("P': </body> token in a <style> attribute value does not fake a body close", () => {
    const input = '<body><style data-y="</body>">.foo{}</style><p>p</p></body>';
    expect(processPartialHtml(input)).toBe(
      '<style data-y="</body>">.foo{}</style><p>p</p>',
    );
  });
});

// ---------------------------------------------------------------------------
// Trailing-entity strip — BY DESIGN, not a bug. At a chunk boundary, a literal
// `&D` is indistinguishable from a developing entity (`&Dagger;`, `&Delta;`, …),
// so the conservative choice is to drop the dangling `&…` run. This is GREEN
// against current source (it pins existing behavior, no source change). It
// self-corrects: the next chunk re-renders with the full text, and the final
// document never runs processPartialHtml at all (the renderer renders the
// completed HTML directly), so `R&D` is whole in the delivered result.
// ---------------------------------------------------------------------------
describe("processPartialHtml — trailing-entity strip (intended tradeoff)", () => {
  it("Q: a chunk ending in literal `&D` drops the dangling run mid-stream", () => {
    // `<p>R&D` → `<p>R`: `&D` could be the start of `&Dagger;`, so the strip is
    // conservative. Pinned as intended — corrected on the next chunk and at
    // completion (the final document does not run processPartialHtml).
    expect(processPartialHtml("<p>R&D")).toBe("<p>R");
  });
});

// ---------------------------------------------------------------------------
// Content after </body> must be RETAINED in the body (final-document parity).
// The final document is mounted whole; a browser reparents anything that
// appears after </body> INTO the body (it is body content, not a wrapper).
// jsdom (the browser-equivalent parser) confirms:
//   new JSDOM("<body><p>x</p></body><div>after</div>").window.document
//     .body.innerHTML === "<p>x</p><div>after</div>"
//   new JSDOM("<body><p>x</p></body><style>.z{color:green}</style>")…
//     .body.innerHTML === "<p>x</p><style>.z{color:green}</style>"
// So the preview must NOT truncate at </body>; it removes the </body> token
// (mask-located, like the </html> strip) and keeps processing what follows.
// A complete <style> after </body> is body-region: it must NOT be hoisted and
// MUST stay in the body (hoist-XOR-keep, never both, never neither).
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — content after </body> retained", () => {
  // RED pre-fix: step 5 sliced off everything from </body>, so <div>after</div>
  // vanished from the preview while the final document reparents it into the body.
  it("R: content after </body> is kept (browser reparents it into the body)", () => {
    const input = "<body><p>x</p></body><div>after</div>";
    expect(processPartialHtml(input)).toBe("<p>x</p><div>after</div>");
  });

  // The </body> token itself is removed (it is not visible content); the body's
  // inner content and the reparented trailing content are concatenated, exactly
  // as the browser flattens them in the final document.
  it("R': the </body> token is removed, not rendered", () => {
    const body = processPartialHtml("<body><p>x</p></body><div>after</div>");
    expect(body).not.toContain("</body>");
  });

  // A complete <style> after </body> is body-region per browser reparenting:
  // NOT hoisted, KEPT in the body (the hoist-XOR-keep invariant must hold).
  it("R'': a complete <style> after </body> stays in the body, not hoisted", () => {
    const input = "<body><p>x</p></body><style>.z{color:green}</style>";
    const body = processPartialHtml(input);
    const hoisted = extractCompleteStyles(input);
    expect(hoisted).toBe(""); // body-region after </body> → never hoisted
    expect(body).toBe("<p>x</p><style>.z{color:green}</style>"); // kept in body
  });

  // Full document: head hoists, body content + post-</body> content both land in
  // the body; the </html> wrapper is still stripped. Matches jsdom body.innerHTML
  // ("<p>x</p><div>after</div>") for the same input.
  it("R''': full document with content after </body></html> keeps the trailing content", () => {
    const input =
      "<html><head><title>t</title></head><body><p>x</p></body><div>after</div></html>";
    expect(processPartialHtml(input)).toBe("<p>x</p><div>after</div>");
  });

  // A </body> token inside a surviving complete <style> must NOT be treated as
  // the structural close (masking guards it), so the style — and the content
  // after it — stay intact.
  it("R'''': </body> token inside CSS content is not the structural close", () => {
    const input =
      '<body><style>.a::after{content:"</body>"}</style><p>p</p></body><div>after</div>';
    expect(processPartialHtml(input)).toBe(
      '<style>.a::after{content:"</body>"}</style><p>p</p><div>after</div>',
    );
  });
});

// ---------------------------------------------------------------------------
// REFUTED reviewer finding (pinned, no source change): a reviewer claimed that
// rejecting a self-closing `<script src="x.js"/>` makes the preview "more
// aggressive than the final document" by dropping the trailing `<p>b</p>`.
// In HTML5 a `<script>` start tag is NOT self-closing — the `/` before `>` is
// ignored, the element stays OPEN, and everything up to a real `</script>` is
// consumed as script content (and never rendered). jsdom confirms:
//   new JSDOM('<div>a</div><script src="x.js"/><p>b</p>').window.document
//     .body.innerHTML === '<div>a</div><script src="x.js"><p>b</p></script>'
//   → script.textContent === "<p>b</p>", 0 rendered <p> elements.
// So the final document does NOT render <p>b</p> either; the preview's stripping
// of everything from `<script` onward yields the SAME visible output. Parity
// holds — the finding is refuted and no source changes.
// ---------------------------------------------------------------------------
describe("processPartialHtml — script-with-trailing-slash parity (refuted finding, pinned)", () => {
  it('S: <script src="x.js"/> swallows the following <p> in both preview and final document', () => {
    // The trailing `<p>b</p>` is script content in HTML5 (not self-closing), so
    // it is invisible in the final document. The preview likewise drops it — the
    // visible result is identical (`<div>a</div>`), so there is no divergence.
    const input = '<div>a</div><script src="x.js"/><p>b</p>';
    expect(processPartialHtml(input)).toBe("<div>a</div>");
  });
});
