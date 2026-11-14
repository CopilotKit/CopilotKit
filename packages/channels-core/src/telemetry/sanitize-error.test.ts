import { describe, it, expect } from "vitest";
import { errorClass, normalizePlatform } from "./sanitize-error.js";

describe("normalizePlatform", () => {
  it("passes through known platforms and buckets the rest as custom", () => {
    expect(normalizePlatform("slack")).toBe("slack");
    expect(normalizePlatform("discord")).toBe("discord");
    expect(normalizePlatform("whatsapp")).toBe("whatsapp");
    expect(normalizePlatform("teams")).toBe("teams");
    // The retired Telegram adapter's label buckets with custom adapters.
    expect(normalizePlatform("telegram")).toBe("custom");
    // Free-form / custom adapter labels must not leak through.
    expect(normalizePlatform("acme-internal-tenant")).toBe("custom");
    expect(normalizePlatform("fake")).toBe("custom");
    expect(normalizePlatform("")).toBe("custom");
  });
});

describe("errorClass", () => {
  it("never leaks the error message", () => {
    const err = new Error("postgres://user:s3cret@db/prod failed");
    const out = errorClass(err);
    expect(out).not.toContain("s3cret");
    expect(["auth", "network", "timeout", "validation", "unknown"]).toContain(
      out,
    );
  });
  it("categorizes by name/code", () => {
    expect(
      errorClass(
        new (class extends Error {
          name = "AbortError";
        })(),
      ),
    ).toBe("timeout");
    expect(
      errorClass(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
    ).toBe("network");
    expect(
      errorClass(
        new (class extends Error {
          name = "ZodError";
        })(),
      ),
    ).toBe("validation");
    expect(errorClass("plain string")).toBe("unknown");
  });
});
