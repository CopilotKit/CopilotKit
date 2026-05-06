import { describe, expect, it } from "vitest";
import {
  extractCompleteStyles,
  processPartialHtml,
} from "./process-partial-html";

describe("extractCompleteStyles", () => {
  it("returns empty string when no style blocks present", () => {
    expect(extractCompleteStyles("<div>hi</div>")).toBe("");
  });

  it("returns concatenated complete <style> blocks", () => {
    const input = "<style>a {}</style><p>x</p><style>b {}</style>";
    expect(extractCompleteStyles(input)).toBe(
      "<style>a {}</style><style>b {}</style>",
    );
  });

  it("ignores incomplete <style> blocks", () => {
    expect(extractCompleteStyles("<style>a {}")).toBe("");
  });
});

describe("processPartialHtml", () => {
  it("strips an incomplete trailing tag", () => {
    expect(processPartialHtml('<div>hi</div><span class="fo')).toBe(
      "<div>hi</div>",
    );
  });

  it("strips complete <style>, <script>, and <head> blocks", () => {
    const input =
      "<head><meta /></head><style>a{}</style><script>x()</script><div>y</div>";
    expect(processPartialHtml(input)).toBe("<div>y</div>");
  });

  it("strips an incomplete <style> block (open with no close)", () => {
    expect(processPartialHtml("<div>x</div><style>a {")).toBe("<div>x</div>");
  });

  it("strips an incomplete HTML entity at the end", () => {
    expect(processPartialHtml("<p>hello &amp")).toBe("<p>hello ");
  });

  it("extracts body content when <body> is present", () => {
    const input = "<html><body><h1>title</h1><p>x</p></body></html>";
    expect(processPartialHtml(input)).toBe("<h1>title</h1><p>x</p>");
  });

  it("returns full string when no <body> wrapper", () => {
    expect(processPartialHtml("<h1>title</h1>")).toBe("<h1>title</h1>");
  });
});
