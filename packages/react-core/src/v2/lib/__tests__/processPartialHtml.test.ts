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
// Unclosed <head> with body markup: the preview must agree with the final
// document's effective rendering (assembleDocument leaves the in-head css in
// the head and the body content in the body when no </head> is emitted —
// browsers implicitly close <head> at <body>). Content must never vanish.
// ---------------------------------------------------------------------------
describe("processPartialHtml / extractCompleteStyles — unclosed <head> implicit body close", () => {
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
  // body, keeping only the body content (parity with the final document).
  it("L': unclosed <head> with title + style before <body> → only body content remains", () => {
    const input =
      "<head><title>t</title><style>.a{}</style><body><p>x</p></body>";
    expect(processPartialHtml(input)).toBe("<p>x</p>");
    expect(extractCompleteStyles(input)).toBe("<style>.a{}</style>");
  });

  // Pin: an unclosed <head> with content but NO <body> token is still stripped
  // (a head genuinely still streaming its own content). Current behavior — kept
  // stable by the implicit-close rule firing ONLY on a <body> token.
  it("M: unclosed <head> + content, NO <body> → stripped (pinned)", () => {
    const input = "<head><style>.a{}</style><p>x</p>";
    expect(processPartialHtml(input)).toBe("");
    expect(extractCompleteStyles(input)).toBe("");
  });

  // A <body> token inside a style/comment within the unclosed head must NOT be
  // taken as the implicit close (masking guards it).
  it("M': <body> token inside CSS in an unclosed head is not the implicit close", () => {
    const input = '<head><style>.a{content:"<body>"}</style><p>x</p>';
    // No REAL <body> token ⇒ unclosed head with no body ⇒ stripped (pinned).
    expect(processPartialHtml(input)).toBe("");
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
// document never runs processPartialHtml at all (assembleDocument renders the
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
