import { describe, it, expect } from "vitest";
import {
  TOOL_STATUS_PREFIXES,
  STREAM_PLACEHOLDERS,
  isBotStatusOrPlaceholder,
} from "./status-markers.js";

describe("status-markers", () => {
  it("exposes the tool-status prefixes the emitter and filter share", () => {
    expect(TOOL_STATUS_PREFIXES).toEqual(["🔧 ", "✅ ", "⏹ "]);
    expect(STREAM_PLACEHOLDERS).toEqual(["_thinking…_", "_…(continued)_"]);
  });

  it("matches every tool-status row, including the interrupt marker", () => {
    expect(isBotStatusOrPlaceholder("🔧 `search`…")).toBe(true);
    expect(isBotStatusOrPlaceholder("✅ `search`")).toBe(true);
    expect(isBotStatusOrPlaceholder("⏹ `search`")).toBe(true);
  });

  it("matches the stream placeholders", () => {
    expect(isBotStatusOrPlaceholder("_thinking…_")).toBe(true);
    expect(isBotStatusOrPlaceholder("_…(continued)_")).toBe(true);
  });

  it("does not match normal reply text", () => {
    expect(isBotStatusOrPlaceholder("Here is the answer.")).toBe(false);
    expect(isBotStatusOrPlaceholder("thinking about it")).toBe(false);
    expect(isBotStatusOrPlaceholder("⏹")).toBe(false); // no trailing space
    expect(isBotStatusOrPlaceholder("")).toBe(false);
  });
});
