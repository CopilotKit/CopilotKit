import { describe, it, expect } from "vitest";
import {
  TOOL_STATUS_PREFIXES,
  STREAM_PLACEHOLDERS,
  isBotStatusOrPlaceholder,
  isBotSender,
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

describe("isBotSender", () => {
  it("treats sender.type === BOT as the bot, regardless of botUserId", () => {
    expect(isBotSender({ type: "BOT" }, "")).toBe(true);
    expect(isBotSender({ type: "BOT", name: "users/123" }, "users/999")).toBe(
      true,
    );
  });

  it("treats a name match against a non-empty botUserId as the bot", () => {
    expect(isBotSender({ type: "HUMAN", name: "users/bot" }, "users/bot")).toBe(
      true,
    );
    expect(isBotSender({ name: "users/bot" }, "users/bot")).toBe(true);
  });

  it("does not match an empty botUserId against empty/undefined sender names", () => {
    expect(isBotSender({ type: "HUMAN", name: "" }, "")).toBe(false);
    expect(isBotSender({ type: "HUMAN" }, "")).toBe(false);
    expect(isBotSender(undefined, "")).toBe(false);
  });

  it("does not treat a human sender as the bot", () => {
    expect(
      isBotSender({ type: "HUMAN", name: "users/alice" }, "users/bot"),
    ).toBe(false);
    expect(isBotSender({ type: "HUMAN", name: "users/alice" }, "")).toBe(false);
  });
});
