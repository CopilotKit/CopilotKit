import { describe, it, expect, vi } from "vitest";
import { DiscordAdapter, discord } from "./adapter.js";

function fakeClient() {
  const handlers: Record<string, (a: unknown) => void> = {};
  return {
    on(e: string, cb: (a: unknown) => void) {
      handlers[e] = cb;
    },
    once(e: string, cb: (a: unknown) => void) {
      handlers[e] = cb;
    },
    login: vi.fn(async () => "ok"),
    destroy: vi.fn(async () => {}),
    user: { id: "bot-1" },
    channels: {
      fetch: vi.fn(async () => ({ id: "c1", send: vi.fn(async () => ({ id: "m1" })) })),
    },
    emit(e: string, a: unknown) {
      handlers[e]?.(a);
    },
  };
}

const sink = () => ({ onTurn: vi.fn(), onInteraction: vi.fn(), onCommand: vi.fn() });

describe("DiscordAdapter", () => {
  it("advertises Discord capabilities (modals off in v1)", () => {
    const a = new DiscordAdapter({ botToken: "t", appId: "app" });
    expect(a.platform).toBe("discord");
    expect(a.capabilities.supportsModals).toBe(false);
    expect(a.capabilities.supportsTyping).toBe(true);
    expect(a.capabilities.supportsReactions).toBe(true);
    expect(a.capabilities.supportsStreaming).toBe(true);
    expect(a.capabilities.maxBlocksPerMessage).toBe(40);
    expect(a.ackDeadlineMs).toBe(3000);
  });

  it("renders IR to a components-v2 container", () => {
    const a = new DiscordAdapter({ botToken: "t", appId: "app" });
    const out = a.render([
      { type: "message", props: { children: { type: "text", props: { value: "hi" } } } },
    ]);
    expect(out).toBeTruthy(); // ContainerBuilder
  });

  it("logs in and captures the bot id on start, publishing commands on ready", async () => {
    const client = fakeClient();
    const put = vi.fn(async () => {});
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put } as never },
    );
    await a.start(sink() as never);
    expect(client.login).toHaveBeenCalledWith("t");
    expect(put).not.toHaveBeenCalled();
    client.emit("ready", client); // discord.js passes the ready client
    // ready handler is async; flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("discord() factory returns an adapter", () => {
    expect(discord({ botToken: "t", appId: "app" })).toBeInstanceOf(DiscordAdapter);
  });
});
