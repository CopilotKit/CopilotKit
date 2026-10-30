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

  it("strips complete <style> blocks", () => {
    const input =
      "<div>Hello</div><style>.foo { color: red; }</style><p>World</p>";
    expect(processPartialHtml(input)).toBe("<div>Hello</div><p>World</p>");
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

  it("extracts a single complete style block", () => {
    const input =
      "<div>Hello</div><style>.foo { color: red; }</style><p>World</p>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>.foo { color: red; }</style>",
    );
  });

  it("extracts multiple complete style blocks", () => {
    const input = "<style>a{}</style><div>X</div><style>b{}</style>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>a{}</style><style>b{}</style>",
    );
  });

  it("ignores incomplete style blocks", () => {
    const input = "<style>.complete{}</style><style>.incomplete {";
    expect(extractCompleteStyles(input)).toBe("<style>.complete{}</style>");
  });

  it("extracts styles from head", () => {
    const input =
      "<head><style>body { margin: 0; }</style></head><body><p>Hi</p></body>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>body { margin: 0; }</style>",
    );
  });
});
