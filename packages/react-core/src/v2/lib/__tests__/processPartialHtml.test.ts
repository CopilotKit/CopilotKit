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

  it("strips complete <style> blocks in the head region (before <body>)", () => {
    // Head-region styles are hoisted into the preview <head> by
    // extractCompleteStyles, so processPartialHtml strips them here to avoid
    // duplicating them in the body.
    const input =
      "<style>.foo { color: red; }</style><body><div>Hello</div><p>World</p></body>";
    expect(processPartialHtml(input)).toBe("<div>Hello</div><p>World</p>");
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
    // hoists nothing).
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

  it("extracts a single complete head-region style block", () => {
    const input =
      "<style>.foo { color: red; }</style><body><p>World</p></body>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>.foo { color: red; }</style>",
    );
  });

  it("extracts multiple complete head-region style blocks", () => {
    const input =
      "<style>a{}</style><div>X</div><style>b{}</style><body></body>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>a{}</style><style>b{}</style>",
    );
  });

  it("ignores incomplete style blocks in the head region", () => {
    const input = "<style>.complete{}</style><style>.incomplete {<body></body>";
    expect(extractCompleteStyles(input)).toBe("<style>.complete{}</style>");
  });

  it("extracts styles from head", () => {
    const input =
      "<head><style>body { margin: 0; }</style></head><body><p>Hi</p></body>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>body { margin: 0; }</style>",
    );
  });

  it("does NOT extract styles from the body region (left in place for cascade parity)", () => {
    // A complete <style> inside the body must stay in the body — hoisting it
    // would flip its cascade position at the preview→final swap.
    const input =
      "<body><div>Hi</div><style>.foo { color: red; }</style></body>";
    expect(extractCompleteStyles(input)).toBe("");
  });

  it("extracts only head-region styles, leaving body-region styles behind", () => {
    // Mixed document: the head style is hoisted, the body style is not.
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
