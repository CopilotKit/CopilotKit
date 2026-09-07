import { describe, expect, it } from "vitest";
import { resolveMessageId } from "../resolve-message-id";

describe("resolveMessageId (#2118)", () => {
  it("preserves a provided non-empty id verbatim", () => {
    expect(resolveMessageId("msg-123")).toBe("msg-123");
  });

  it.each(["", null, undefined] as const)(
    "falls back to a generated id when the event id is %p",
    (input) => {
      const id = resolveMessageId(input);
      // randomId() always produces the "ck-<uuid>" shape; the important
      // contract for #2118 is that the returned value is a non-empty string,
      // never null/undefined.
      expect(id).toMatch(/^ck-[0-9a-f-]{36}$/);
    },
  );

  it("generates a fresh id on each fallback call", () => {
    const a = resolveMessageId(undefined);
    const b = resolveMessageId(undefined);
    expect(a).not.toBe(b);
  });
});
