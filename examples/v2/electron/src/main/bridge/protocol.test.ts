import { describe, it, expect } from "vitest";
import { parseInbound } from "./protocol";
import type { BridgeInbound } from "./protocol";

describe("parseInbound — result reply", () => {
  it("parses a {type:'result',id,data} JSON string to the result shape", () => {
    const raw = JSON.stringify({
      type: "result",
      id: "abc-1",
      data: { url: "https://example.com" },
    });
    const msg = parseInbound(raw) as Extract<BridgeInbound, { type: "result" }>;

    expect(msg.type).toBe("result");
    expect(msg.id).toBe("abc-1");
    expect(msg.data).toEqual({ url: "https://example.com" });
  });
});

describe("parseInbound — error reply", () => {
  it("parses a {type:'error',id,message} JSON string to the error shape", () => {
    const raw = JSON.stringify({
      type: "error",
      id: "xyz-2",
      message: "tab not found",
    });
    const msg = parseInbound(raw) as Extract<BridgeInbound, { type: "error" }>;

    expect(msg.type).toBe("error");
    expect(msg.id).toBe("xyz-2");
    expect(msg.message).toBe("tab not found");
  });
});

describe("parseInbound — ping", () => {
  it("parses a {type:'ping'} JSON string to the ping shape", () => {
    const raw = JSON.stringify({ type: "ping" });
    const msg = parseInbound(raw);

    expect(msg.type).toBe("ping");
  });
});

describe("parseInbound — invalid input", () => {
  it("throws when the input is not valid JSON", () => {
    expect(() => parseInbound("not json at all")).toThrow();
  });

  it("throws when the object has an unknown type", () => {
    const raw = JSON.stringify({ type: "bogus", id: "1" });
    expect(() => parseInbound(raw)).toThrow();
  });
});
