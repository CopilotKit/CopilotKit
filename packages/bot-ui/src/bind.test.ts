import { describe, it, expect } from "vitest";
import { bind, isBound, getBoundArgs, getBoundHandler } from "./bind.js";

describe("bind", () => {
  it("tags a handler with serializable args", () => {
    const h = () => {};
    const b = bind(h, { flightId: "x1" });
    expect(isBound(b)).toBe(true);
    expect(getBoundArgs(b)).toEqual({ flightId: "x1" });
    expect(getBoundHandler(b)).toBe(h);
  });
  it("plain handler is not bound", () => {
    expect(isBound(() => {})).toBe(false);
  });
});
