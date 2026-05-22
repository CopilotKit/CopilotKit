import { describe, it, expect } from "vitest";
import {
  decodeSandboxArgs,
  encodeSandboxArgs,
  isParentToSandboxMessage,
  isSandboxToParentMessage,
  parseSandboxParams,
  SANDBOX_ARGS_URL_LIMIT_BYTES,
} from "../sandbox-params";

describe("sandbox-params: encode/decode roundtrip", () => {
  it("roundtrips a simple object", () => {
    const args = { ticker: "AAPL", range: "1M" };
    const encoded = encodeSandboxArgs(args);
    expect(encoded).not.toBeNull();
    expect(decodeSandboxArgs(encoded!)).toEqual(args);
  });

  it("roundtrips Unicode strings", () => {
    const args = { greeting: "héllo — 🚀", city: "São Paulo" };
    const encoded = encodeSandboxArgs(args);
    expect(encoded).not.toBeNull();
    expect(decodeSandboxArgs(encoded!)).toEqual(args);
  });

  it("encodes null and undefined values as empty object", () => {
    expect(decodeSandboxArgs(encodeSandboxArgs(null)!)).toEqual({});
    expect(decodeSandboxArgs(encodeSandboxArgs(undefined)!)).toEqual({});
  });

  it("returns null for payloads above the URL size limit", () => {
    const big = { blob: "x".repeat(SANDBOX_ARGS_URL_LIMIT_BYTES * 2) };
    expect(encodeSandboxArgs(big)).toBeNull();
  });

  it("uses a URL-safe base64 alphabet (no + or /)", () => {
    // The character '?' produces a '+' in standard base64 alphabet padding
    // patterns; the URL-safe encoder must replace it with '-' / '_'.
    const args = { q: "??>>>>" };
    const encoded = encodeSandboxArgs(args);
    expect(encoded).not.toBeNull();
    expect(encoded!).not.toContain("+");
    expect(encoded!).not.toContain("/");
    expect(encoded!).not.toContain("=");
  });
});

describe("sandbox-params: parseSandboxParams", () => {
  const baseUrl = "http://localhost:3000/";

  it("returns null when the URL has no __cpk_sandbox param", () => {
    expect(parseSandboxParams(baseUrl)).toBeNull();
    expect(parseSandboxParams(`${baseUrl}?other=value`)).toBeNull();
  });

  it("parses a tool name without args", () => {
    const result = parseSandboxParams(`${baseUrl}?__cpk_sandbox=stock_chart`);
    expect(result).toEqual({
      toolName: "stock_chart",
      args: undefined,
      argsParseError: null,
    });
  });

  it("parses a tool name and decoded args", () => {
    const args = { ticker: "MSFT" };
    const encoded = encodeSandboxArgs(args)!;
    const result = parseSandboxParams(
      `${baseUrl}?__cpk_sandbox=stock_chart&args=${encoded}`,
    );
    expect(result?.toolName).toBe("stock_chart");
    expect(result?.args).toEqual(args);
    expect(result?.argsParseError).toBeNull();
  });

  it("captures an args-parse error when the blob is malformed", () => {
    const result = parseSandboxParams(
      `${baseUrl}?__cpk_sandbox=stock_chart&args=not-valid-base64-json`,
    );
    expect(result?.toolName).toBe("stock_chart");
    expect(result?.args).toBeUndefined();
    expect(result?.argsParseError).not.toBeNull();
    expect(typeof result!.argsParseError).toBe("string");
  });

  it("returns null when the URL itself is malformed", () => {
    expect(parseSandboxParams("not a url")).toBeNull();
  });
});

describe("sandbox-params: type guards", () => {
  it("isSandboxToParentMessage accepts the three valid shapes", () => {
    expect(isSandboxToParentMessage({ kind: "ready", needsArgs: true })).toBe(
      true,
    );
    expect(
      isSandboxToParentMessage({ kind: "render-error", message: "x" }),
    ).toBe(true);
    expect(isSandboxToParentMessage({ kind: "request-args" })).toBe(true);
  });

  it("isSandboxToParentMessage rejects unknown shapes", () => {
    expect(isSandboxToParentMessage(null)).toBe(false);
    expect(isSandboxToParentMessage(undefined)).toBe(false);
    expect(isSandboxToParentMessage(42)).toBe(false);
    expect(isSandboxToParentMessage({ kind: "bogus" })).toBe(false);
    expect(isSandboxToParentMessage({ noKind: true })).toBe(false);
  });

  it("isParentToSandboxMessage accepts the two valid shapes", () => {
    expect(
      isParentToSandboxMessage({ kind: "host-context", theme: "dark" }),
    ).toBe(true);
    expect(isParentToSandboxMessage({ kind: "args", args: {} })).toBe(true);
  });

  it("isParentToSandboxMessage rejects unknown shapes", () => {
    expect(isParentToSandboxMessage(null)).toBe(false);
    expect(isParentToSandboxMessage({ kind: "ready" })).toBe(false);
  });
});
