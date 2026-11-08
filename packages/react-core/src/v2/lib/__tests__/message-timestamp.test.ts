import { describe, expect, it } from "vitest";
import {
  readMessageTimestamp,
  recordMessageTimestamps,
  stampMessageTimestamp,
  withMessageTimestamp,
} from "../message-timestamp";

const EPOCH = Date.UTC(2026, 0, 2, 3, 4, 5);

describe("readMessageTimestamp", () => {
  it("reads metadata.timestamp epoch milliseconds", () => {
    expect(readMessageTimestamp({ metadata: { timestamp: EPOCH } })).toBe(
      EPOCH,
    );
  });

  it("reads an ISO metadata timestamp", () => {
    expect(
      readMessageTimestamp({
        metadata: { timestamp: "2026-01-02T03:04:05.000Z" },
      }),
    ).toBe(EPOCH);
  });

  it("reads a top-level timestamp when metadata has none", () => {
    expect(readMessageTimestamp({ timestamp: EPOCH })).toBe(EPOCH);
  });

  it("prefers metadata.timestamp over a top-level timestamp", () => {
    expect(
      readMessageTimestamp({ metadata: { timestamp: EPOCH }, timestamp: 1 }),
    ).toBe(EPOCH);
  });

  it("returns undefined for missing and invalid times", () => {
    expect(readMessageTimestamp({})).toBeUndefined();
    expect(readMessageTimestamp({ metadata: {} })).toBeUndefined();
    expect(
      readMessageTimestamp({ metadata: { timestamp: "nope" } }),
    ).toBeUndefined();
    expect(
      readMessageTimestamp({ metadata: { timestamp: Number.NaN } }),
    ).toBeUndefined();
    expect(readMessageTimestamp({ metadata: null })).toBeUndefined();
  });
});

describe("withMessageTimestamp", () => {
  it("copies the message and records the time", () => {
    const message: {
      id: string;
      role: "user";
      content: string;
      metadata?: Record<string, number>;
    } = { id: "u1", role: "user", content: "Hi" };
    const stamped = withMessageTimestamp(message, EPOCH);
    expect(stamped).not.toBe(message);
    expect(stamped.metadata).toEqual({ timestamp: EPOCH });
    expect(message.metadata).toBeUndefined();
  });

  it("keeps an existing timestamp and other metadata", () => {
    const message = {
      id: "u1",
      role: "user" as const,
      content: "Hi",
      metadata: { filename: "a.png", timestamp: 5 },
    };
    expect(withMessageTimestamp(message, EPOCH)).toBe(message);
  });
});

describe("recordMessageTimestamps", () => {
  it("stamps a message that just started and remembers the time", () => {
    const message: {
      id: string;
      role: "assistant";
      content: string;
      metadata?: Record<string, number>;
    } = { id: "a1", role: "assistant", content: "" };
    const pending = new Map([["a1", EPOCH]]);
    const remembered = new Map<string, number>();

    recordMessageTimestamps([message], pending, remembered);

    expect(message.metadata).toEqual({ timestamp: EPOCH });
    expect(pending.size).toBe(0);
    expect(remembered.get("a1")).toBe(EPOCH);
  });

  it("does not invent a time for a message that never started", () => {
    const message = { id: "old", role: "assistant" as const, content: "Hi" };
    recordMessageTimestamps([message], new Map(), new Map());
    expect(message).not.toHaveProperty("metadata");
  });

  it("does not overwrite a timestamp already on the message", () => {
    const message = {
      id: "a1",
      role: "assistant" as const,
      content: "Hi",
      metadata: { timestamp: 5, source: "saved" },
    };
    recordMessageTimestamps([message], new Map([["a1", EPOCH]]), new Map());
    expect(message.metadata).toEqual({ timestamp: 5, source: "saved" });
  });

  it("restores a remembered time after a snapshot drops it", () => {
    const remembered = new Map([["a1", EPOCH]]);
    const restored = { id: "a1", role: "assistant" as const, content: "Hi" };

    recordMessageTimestamps([restored], new Map(), remembered);

    expect(readMessageTimestamp(restored)).toBe(EPOCH);
  });

  it("stampMessageTimestamp ignores a non-finite time", () => {
    const message: { metadata?: Record<string, unknown> } = {};
    stampMessageTimestamp(message, Number.POSITIVE_INFINITY);
    expect(message.metadata).toBeUndefined();
  });
});
