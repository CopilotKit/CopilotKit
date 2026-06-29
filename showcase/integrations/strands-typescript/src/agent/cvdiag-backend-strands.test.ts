import { describe, expect, it } from "vitest";

import { sseChunkByteLength } from "./cvdiag-backend-strands.js";

describe("sseChunkByteLength", () => {
  it("reports the byte length of a Uint8Array chunk (not 0)", () => {
    // A multi-byte payload: "héllo" — the é encodes to 2 bytes in UTF-8.
    const chunk = new TextEncoder().encode("héllo"); // Uint8Array, byteLength 6
    expect(chunk).toBeInstanceOf(Uint8Array);
    expect(chunk).not.toBeInstanceOf(Buffer);

    expect(sseChunkByteLength(chunk)).toBe(chunk.byteLength);
    expect(sseChunkByteLength(chunk)).toBe(6);
  });

  it("measures string chunks via UTF-8 byte length", () => {
    expect(sseChunkByteLength("héllo")).toBe(6);
  });

  it("measures Buffer chunks", () => {
    const buf = Buffer.from("héllo", "utf8");
    expect(sseChunkByteLength(buf)).toBe(6);
  });

  it("returns 0 for unknown chunk types", () => {
    expect(sseChunkByteLength(undefined)).toBe(0);
    expect(sseChunkByteLength(42)).toBe(0);
  });
});
