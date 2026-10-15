import { describe, it, expect } from "vitest";
import { errorClass, normalizePlatform } from "./sanitize-error.js";

describe("normalizePlatform", () => {
  it.each(["slack", "whatsapp", "teams"])(
    "passes through the official %s platform",
    (platform) => {
      expect(normalizePlatform(platform)).toBe(platform);
    },
  );

  it.each(["discord", "telegram"])(
    "buckets the retired %s platform as custom",
    (platform) => {
      expect(normalizePlatform(platform)).toBe("custom");
    },
  );

  // Free-form / custom adapter labels must not leak through.
  it.each(["acme-internal-tenant", "fake", ""])(
    "buckets the caller-chosen label %j as custom",
    (platform) => {
      expect(normalizePlatform(platform)).toBe("custom");
    },
  );
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
