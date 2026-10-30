import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bytesToBase64, sha256Hex } from "../core/web-crypto";

// The helpers replace `Buffer` and `node:crypto` so the runtime bundles for
// edge runtimes; they must keep producing exactly what those produced.
function bytesOfLength(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return bytes;
}

// 0x8000 is the internal base64 chunk size, so cover both sides of it.
const LENGTHS = [0, 1, 2, 3, 4, 255, 0x7fff, 0x8000, 0x8001, 200_000];

describe("bytesToBase64", () => {
  it.each(LENGTHS)("matches Buffer for %i bytes", (length) => {
    const bytes = bytesOfLength(length);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes a subarray view, not its whole backing buffer", () => {
    const view = bytesOfLength(64).subarray(10, 20);
    expect(bytesToBase64(view)).toBe(Buffer.from(view).toString("base64"));
  });
});

describe("sha256Hex", () => {
  it.each(LENGTHS)("matches node:crypto for %i bytes", async (length) => {
    const bytes = bytesOfLength(length);
    expect(await sha256Hex(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it.each(["", "abc", "héllo wörld ✓", '[["a","rev-1","\\"etag\\""]]'])(
    "hashes the UTF-8 bytes of %j",
    async (text) => {
      expect(await sha256Hex(text)).toBe(
        createHash("sha256").update(text, "utf8").digest("hex"),
      );
    },
  );
});
