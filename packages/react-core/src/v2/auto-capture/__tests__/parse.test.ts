import { describe, expect, it } from "vitest";
import {
  formDataToObject,
  formUrlEncodedToObject,
  parseBodyText,
  toAbsoluteUrl,
} from "../parse";

describe("parseBodyText", () => {
  it("parses JSON bodies by content-type", () => {
    expect(parseBodyText('{"a":1}', "application/json")).toEqual({ a: 1 });
  });

  it("parses form-urlencoded bodies into a flat object", () => {
    expect(
      parseBodyText("a=1&b=two", "application/x-www-form-urlencoded"),
    ).toEqual({ a: "1", b: "two" });
  });

  it("attempts JSON when the body looks like JSON but has no content-type", () => {
    expect(parseBodyText('{"a":1}', null)).toEqual({ a: 1 });
  });

  it("falls back to the raw string on malformed JSON", () => {
    expect(parseBodyText("{not json", "application/json")).toBe("{not json");
  });

  it("returns undefined for an empty body", () => {
    expect(parseBodyText("", "application/json")).toBeUndefined();
    expect(parseBodyText(null, null)).toBeUndefined();
  });

  it("keeps unknown non-JSON text as a string", () => {
    expect(parseBodyText("plain text", "text/plain")).toBe("plain text");
  });
});

describe("formUrlEncodedToObject", () => {
  it("decodes query-style bodies", () => {
    expect(formUrlEncodedToObject("name=alice&city=NYC")).toEqual({
      name: "alice",
      city: "NYC",
    });
  });
});

describe("formDataToObject", () => {
  it("keeps string fields and replaces files with a placeholder", () => {
    const form = new FormData();
    form.append("title", "hello");
    form.append("file", new Blob(["x"]), "x.txt");

    expect(formDataToObject(form)).toEqual({
      title: "hello",
      file: "[file]",
    });
  });
});

describe("toAbsoluteUrl", () => {
  it("resolves a relative URL against the document origin", () => {
    expect(toAbsoluteUrl("/api/orders")).toBe(
      `${window.location.origin}/api/orders`,
    );
  });

  it("leaves an absolute URL unchanged", () => {
    expect(toAbsoluteUrl("https://other.test/x")).toBe("https://other.test/x");
  });
});
