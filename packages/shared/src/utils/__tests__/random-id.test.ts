import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId, randomUUID } from "../random-id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUUID", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns crypto.randomUUID() when it exists", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
    });
    expect(randomUUID()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("builds a v4 UUID from getRandomValues when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
    });
    const id = randomUUID();
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(id).toMatch(UUID_V4);
  });

  it("throws a clear error when the runtime has no crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => randomUUID()).toThrow(/getRandomValues/);
  });

  it("prefixes randomId with ck-", () => {
    expect(randomId()).toMatch(/^ck-/);
    expect(randomId().slice(3)).toMatch(UUID_V4);
  });
});
