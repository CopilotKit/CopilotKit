import { describe, expect, it } from "vitest";
import { createObjectReferences } from "./references";

describe("capture-local object references", () => {
  const base = "https://example.test";

  it("consistently links numeric and opaque object IDs without emitting them", () => {
    const refs = createObjectReferences();
    expect(refs.reference("record-48319")).toBe("object-1");
    expect(refs.reference(12345)).toBe("object-2");
    expect(refs.reference("12345")).toBe("object-2");
    expect(
      refs.forUrl("/api/orders/record-48319", base, "/api/orders/:redacted"),
    ).toEqual([{ pathSegment: 2, reference: "object-1" }]);
    expect(
      refs.forUrl(
        "/api/orders/12345?token=private",
        base,
        "/api/orders/:redacted",
      ),
    ).toEqual([{ pathSegment: 2, reference: "object-2" }]);
  });

  it("only associates genuinely ID-redacted pathname segments", () => {
    const refs = createObjectReferences();
    for (const [raw, safe] of [
      ["/api/orders/12345", "/api/orders/12345"],
      ["/api/orders/custom-slug", "/api/orders/:redacted"],
      ["/api/orders/12345", "/api"],
      ["/api/orders/12345", "https://other.test/api/orders/:redacted"],
      ["/api/orders/12345", "/api/orders/:redacted/extra"],
    ])
      expect(refs.forUrl(raw, base, safe)).toBeUndefined();
  });

  it("does not create references for credentials, private paths or email routes", () => {
    const refs = createObjectReferences();
    for (const value of [
      "private-id",
      "access-token",
      "alice@example.test",
      "https://example.test",
      "a b",
      "",
      "x".repeat(129),
      Number.NaN,
      1.5,
    ])
      expect(refs.reference(value)).toBeUndefined();
    for (const path of [
      "/api/token/12345",
      "/api/private/12345",
      "/api/%70rivate/12345",
      "/api/alice%40example.test/12345",
      "/api/%252570rivate/12345",
      "https://user:pass@example.test/api/orders/12345",
    ])
      expect(
        refs.forUrl(path, base, "/api/:redacted/:redacted"),
      ).toBeUndefined();
  });

  it("bounds each capture map, reuses existing IDs and releases all values on clear", () => {
    const refs = createObjectReferences();
    for (let index = 0; index < 256; index++)
      expect(refs.reference(`record-${index}`)).toBe(`object-${index + 1}`);
    expect(refs.reference("record-256")).toBeUndefined();
    expect(refs.reference("record-0")).toBe("object-1");
    refs.clear();
    expect(refs.reference("new-record")).toBe("object-1");
    expect(createObjectReferences().reference("other-record")).toBe("object-1");
  });
});
