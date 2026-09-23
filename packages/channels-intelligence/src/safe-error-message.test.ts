import { describe, expect, test } from "vitest";
import {
  SAFE_ERROR_MESSAGE_MAX_LENGTH,
  redactSecretLikeValues,
  safeErrorMessage,
} from "./safe-error-message.js";

// Token-shaped fixtures are assembled at runtime so no literal that looks like
// a real credential lives in the source.
const join = (...parts: string[]) => parts.join("");

describe("redactSecretLikeValues", () => {
  test.each([
    ["Slack bot token", join("xo", "xb-1111111111-2222222222-abcdefABCDEF")],
    ["Slack app token", join("xa", "pp-1-A0000000000-1111111111-abcdef")],
    ["provider key", join("s", "k-ant-api03-abcdefgh12345678")],
    ["CopilotKit key", join("cp", "k-abcdef1234567890")],
    [
      "JWT",
      join("ey", "JhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl"),
    ],
    ["long opaque value", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8"],
  ])("redacts a %s", (_label, secret) => {
    const redacted = redactSecretLikeValues(`failed with ${secret} today`);
    expect(redacted).toBe("failed with [redacted] today");
  });

  test("redacts authorization header values", () => {
    expect(
      redactSecretLikeValues("sent Bearer abc.def and Basic dXNlcg=="),
    ).toBe("sent Bearer [redacted] and Basic [redacted]");
  });

  test("redacts values of secret-named keys", () => {
    expect(
      redactSecretLikeValues(
        'joinToken=abc123 api_key: "short" password=hunter2&next=1',
      ),
    ).toBe(
      'joinToken=[redacted] api_key: "[redacted]" password=[redacted]&next=1',
    );
  });

  test("redacts URL credentials but keeps the host", () => {
    expect(
      redactSecretLikeValues("connect https://user:pa55@db.example.com/x"),
    ).toBe("connect https://[redacted]@db.example.com/x");
  });

  test("leaves ordinary text alone", () => {
    const text =
      "createChannel: no agent configured (pass `agent` to use runAgent); deliveryId dlv_delivery_01";
    expect(redactSecretLikeValues(text)).toBe(text);
    expect(redactSecretLikeValues("x".repeat(64))).toBe("x".repeat(64));
  });
});

describe("safeErrorMessage", () => {
  test("returns the message of an Error, a string, or a message-shaped object", () => {
    expect(safeErrorMessage(new Error("boom"))).toBe("boom");
    expect(safeErrorMessage("plain failure")).toBe("plain failure");
    expect(safeErrorMessage({ message: "object failure" })).toBe(
      "object failure",
    );
  });

  test("returns undefined when there is nothing to report", () => {
    expect(safeErrorMessage(undefined)).toBeUndefined();
    expect(safeErrorMessage(null)).toBeUndefined();
    expect(safeErrorMessage(42)).toBeUndefined();
    expect(safeErrorMessage(new Error(""))).toBeUndefined();
    expect(safeErrorMessage(new Error(" \n\t "))).toBeUndefined();
  });

  test("collapses newlines and control characters to one line", () => {
    expect(safeErrorMessage(new Error("line one\nline two\r\n\u0007end"))).toBe(
      "line one line two end",
    );
  });

  test("bounds the length", () => {
    const message = safeErrorMessage(new Error("word ".repeat(1_000)))!;
    expect(message.length).toBe(SAFE_ERROR_MESSAGE_MAX_LENGTH);
    expect(message.endsWith("…")).toBe(true);
  });

  test("redacts before truncating so a cut secret cannot leak a prefix", () => {
    const secret = join("xo", "xb-", "9".repeat(400));
    const message = safeErrorMessage(
      new Error(`${"a ".repeat(140)}${secret}`),
    )!;
    expect(message).not.toContain(join("xo", "xb"));
    expect(message).not.toMatch(/9{5,}/);
  });

  test("never includes the stack", () => {
    const error = new Error("top-level message");
    expect(safeErrorMessage(error)).toBe("top-level message");
  });
});
