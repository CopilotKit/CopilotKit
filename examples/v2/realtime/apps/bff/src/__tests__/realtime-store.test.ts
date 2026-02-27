import { describe, expect, it } from "vitest";
import type { BaseEvent } from "@ag-ui/client";
import { RealtimeStore } from "../realtime-store.js";

class MockRedis {
  data = new Map<string, string>();
  channels = new Map<string, string[]>();

  async connect() {}
  async quit() {}

  async set(key: string, value: string, options?: { NX?: boolean }) {
    if (options?.NX && this.data.has(key)) {
      return null;
    }
    this.data.set(key, value);
    return "OK";
  }

  async get(key: string) {
    return this.data.get(key) ?? null;
  }

  async del(key: string) {
    this.data.delete(key);
    return 1;
  }

  async publish(channel: string, message: string) {
    const existing = this.channels.get(channel) ?? [];
    existing.push(message);
    this.channels.set(channel, existing);
    return 1;
  }

  async eval(_script: string, params: { keys: string[]; arguments: string[] }) {
    const key = params.keys[0];
    const expected = params.arguments[0];
    if (!key || !expected) {
      return 0;
    }
    if (this.data.get(key) === expected) {
      this.data.delete(key);
      return 1;
    }
    return 0;
  }
}

describe("RealtimeStore", () => {
  it("enforces one-at-a-time thread locks", async () => {
    const redis = new MockRedis();
    const store = new RealtimeStore(redis as never);

    expect(await store.acquireThreadLock("thread-a", "run-1")).toBe(true);
    expect(await store.acquireThreadLock("thread-a", "run-2")).toBe(false);

    await store.releaseThreadLock("thread-a", "run-1");
    expect(await store.acquireThreadLock("thread-a", "run-3")).toBe(true);
  });

  it("stores replay payload and thread history", async () => {
    const redis = new MockRedis();
    const store = new RealtimeStore(redis as never);

    const replayEvent: BaseEvent = {
      type: "RUN_ERROR",
      message: "replay",
    } as BaseEvent;

    const token = await store.issueToken({
      agentId: "default",
      threadId: "thread-1",
      replayEvents: [replayEvent],
    });

    const replay = await store.getTokenReplay(token.token);
    expect(replay).toHaveLength(1);

    await store.appendThreadEvent("thread-1", replayEvent);
    const history = await store.getThreadEvents("thread-1");
    expect(history).toHaveLength(1);
    expect(redis.channels.get("ck:thread:thread-1:pubsub")).toHaveLength(1);
  });
});
