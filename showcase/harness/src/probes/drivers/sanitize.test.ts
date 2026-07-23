import { describe, it, expect } from "vitest";
import { sanitizeErrorDesc } from "./sanitize.js";

describe("sanitizeErrorDesc", () => {
  it("strips_html_tags", () => {
    const input =
      "<html><body><h1>404</h1><p>This page could not be found.</p></body></html>";
    expect(sanitizeErrorDesc(input)).toBe("404 This page could not be found.");
  });

  it("collapses_whitespace", () => {
    expect(sanitizeErrorDesc("foo\n\n\t  bar   baz")).toBe("foo bar baz");
  });

  it("caps_at_default_120_with_ellipsis", () => {
    const input = "a".repeat(500);
    const out = sanitizeErrorDesc(input);
    expect(out).toHaveLength(120);
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects_custom_maxLen", () => {
    const out = sanitizeErrorDesc("a".repeat(50), 10);
    expect(out).toBe("aaaaaaaaa…");
    expect(out).toHaveLength(10);
  });

  it("returns_empty_for_empty", () => {
    expect(sanitizeErrorDesc("")).toBe("");
  });

  it("returns_empty_for_whitespace_only", () => {
    expect(sanitizeErrorDesc("   \n\t")).toBe("");
  });

  it("strips_script_and_style_bodies", () => {
    expect(sanitizeErrorDesc("<script>alert(1)</script>hello")).toBe("hello");
    expect(sanitizeErrorDesc("<style>body{}</style>hello")).toBe("hello");
  });

  it("strips_entity_encoded_script_tags", () => {
    // Ordering contract: decode must run, then script-body strip must
    // run AGAIN to remove the now-decoded <script> payload.
    const input = "&lt;script&gt;alert(1)&lt;/script&gt;payload";
    expect(sanitizeErrorDesc(input)).toBe("payload");
  });

  it("strips_html_entities", () => {
    // After decode, <div> is stripped as a tag; & passes through
    // bracket-neutralization unchanged since it's not < or >.
    expect(sanitizeErrorDesc("&lt;div&gt;hi&amp;bye")).toBe("hi&bye");
  });

  it("defends_against_mrkdwn_injection", () => {
    const input = "<!channel> <!here> <@U12345> `backtick`";
    const out = sanitizeErrorDesc(input);
    expect(out).not.toContain("<!");
    expect(out).not.toContain("`");
  });
});
