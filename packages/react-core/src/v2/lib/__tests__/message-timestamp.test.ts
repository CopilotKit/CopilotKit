import { describe, expect, it } from "vitest";
import {
  isDisplayableMessageTimestamp,
  messagesWithTimestamps,
  readMessageTimestamp,
  recordMessageTimestamps,
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

  it("uses a valid top-level timestamp when metadata timestamp is invalid", () => {
    expect(
      readMessageTimestamp({
        metadata: { timestamp: "nope" },
        timestamp: EPOCH,
      }),
    ).toBe(EPOCH);
  });
});

describe("isDisplayableMessageTimestamp", () => {
  it("rejects times that Date cannot format as ISO", () => {
    expect(isDisplayableMessageTimestamp(EPOCH)).toBe(true);
    expect(isDisplayableMessageTimestamp(1e16)).toBe(false);
    expect(isDisplayableMessageTimestamp(Number.POSITIVE_INFINITY)).toBe(false);
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
  it("remembers a started message without writing to it", () => {
    const message = Object.freeze({
      id: "a1",
      role: "assistant" as const,
      content: "",
    });
    const pending = new Map([["a1", EPOCH]]);
    const remembered = new Map<string, number>();

    expect(() =>
      recordMessageTimestamps([message], pending, remembered),
    ).not.toThrow();

    expect(message).not.toHaveProperty("metadata");
    expect(pending.size).toBe(0);
    expect(remembered.get("a1")).toBe(EPOCH);
    const [copy] = messagesWithTimestamps([message], remembered);
    expect(copy).not.toBe(message);
    expect(readMessageTimestamp(copy)).toBe(EPOCH);
  });

  it("does not invent a time for a message that never started", () => {
    const message = { id: "old", role: "assistant" as const, content: "Hi" };
    const remembered = new Map<string, number>();
    recordMessageTimestamps([message], new Map(), remembered);
    expect(message).not.toHaveProperty("metadata");
    expect(remembered.size).toBe(0);
    expect(messagesWithTimestamps([message], remembered)).toEqual([message]);
  });

  it("keeps a timestamp already on the message", () => {
    const message = Object.freeze({
      id: "a1",
      role: "assistant" as const,
      content: "Hi",
      metadata: { timestamp: 5, source: "saved" },
    });
    const remembered = new Map<string, number>();
    recordMessageTimestamps([message], new Map([["a1", EPOCH]]), remembered);
    expect(message.metadata).toEqual({ timestamp: 5, source: "saved" });
    expect(remembered.get("a1")).toBe(5);
  });

  it("keeps a remembered time after a snapshot drops it", () => {
    const remembered = new Map([["a1", EPOCH]]);
    const restored = Object.freeze({
      id: "a1",
      role: "assistant" as const,
      content: "Hi",
    });

    recordMessageTimestamps([restored], new Map(), remembered);

    expect(restored).not.toHaveProperty("metadata");
    expect(remembered.get("a1")).toBe(EPOCH);
    const [copy] = messagesWithTimestamps([restored], remembered);
    expect(readMessageTimestamp(copy)).toBe(EPOCH);
  });
});
