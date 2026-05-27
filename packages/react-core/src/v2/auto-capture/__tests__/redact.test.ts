import { describe, expect, it } from "vitest";
import {
  DEFAULT_MASK,
  redactUrlQuery,
  redactValue,
  resolveRedaction,
} from "../redact";

describe("resolveRedaction", () => {
  it("defaults to masking with the built-in key list", () => {
    const redaction = resolveRedaction();

    expect(redaction.replaceWith).toBe(DEFAULT_MASK);
    expect(redaction.keys.has("password")).toBe(true);
    expect(redaction.keys.has("authorization")).toBe(true);
  });

  it("merges custom keys (lower-cased) on top of the built-ins", () => {
    const redaction = resolveRedaction({ keys: ["X-Custom-Secret"] });

    expect(redaction.keys.has("x-custom-secret")).toBe(true);
    expect(redaction.keys.has("password")).toBe(true);
  });

  it("honors an explicit null replaceWith (remove mode)", () => {
    const redaction = resolveRedaction({ replaceWith: null });

    expect(redaction.replaceWith).toBeNull();
  });
});

describe("redactValue", () => {
  it("masks sensitive keys case-insensitively and recursively", () => {
    const redaction = resolveRedaction();

    const result = redactValue(
      {
        username: "alice",
        Password: "hunter2",
        nested: { apiKey: "abc", keep: 1 },
        list: [{ token: "t" }],
      },
      redaction,
    );

    expect(result).toEqual({
      username: "alice",
      Password: "***",
      nested: { apiKey: "***", keep: 1 },
      list: [{ token: "***" }],
    });
  });

  it("removes keys entirely when replaceWith is null", () => {
    const redaction = resolveRedaction({ replaceWith: null });

    const result = redactValue({ name: "x", password: "secret" }, redaction);

    expect(result).toEqual({ name: "x" });
  });

  it("does not mutate the input", () => {
    const redaction = resolveRedaction();
    const input = { password: "secret" };

    redactValue(input, redaction);

    expect(input.password).toBe("secret");
  });

  it("passes primitives through unchanged", () => {
    const redaction = resolveRedaction();

    expect(redactValue("hello", redaction)).toBe("hello");
    expect(redactValue(42, redaction)).toBe(42);
    expect(redactValue(undefined, redaction)).toBeUndefined();
  });
});

describe("redactUrlQuery", () => {
  it("masks sensitive query params and leaves others intact", () => {
    const redaction = resolveRedaction();

    const result = redactUrlQuery(
      "https://app.test/checkout?token=abc&page=2",
      redaction,
    );

    expect(result).toBe("https://app.test/checkout?token=***&page=2");
  });

  it("removes sensitive query params when replaceWith is null", () => {
    const redaction = resolveRedaction({ replaceWith: null });

    const result = redactUrlQuery(
      "https://app.test/checkout?token=abc&page=2",
      redaction,
    );

    expect(result).toBe("https://app.test/checkout?page=2");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    const redaction = resolveRedaction();

    expect(redactUrlQuery("not a url", redaction)).toBe("not a url");
  });
});
