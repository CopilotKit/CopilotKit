import { afterEach, describe, expect, it, vi } from "vitest";
import { runSmoke } from "../../../integrations/acp-agent/src/lib/smoke-runner";

const originalEnvironment = { ...process.env };

const admissionResponse = (): Response =>
  Response.json({
    joinToken: "jt_showcase_0123456789",
    realtime: {
      clientUrl: "wss://realtime.example.com/client",
      topic: "thread:smoke-thread",
    },
    runId: "smoke-run",
    threadId: "smoke-thread",
  });

const socketFactoryFor = (...events: readonly object[]) => {
  return (_url: string, _options: object) => {
    const handlers = new Map<string, Array<(payload: unknown) => void>>();
    const channel = {
      join: () => {
        const push = {
          receive: (_status: string, _callback: (payload?: unknown) => void) =>
            push,
        };
        return push;
      },
      leave: vi.fn(),
      on: (event: string, callback: (payload: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), callback]);
      },
      onClose: vi.fn(),
      onError: vi.fn(),
    };
    return {
      channel: vi.fn(() => channel),
      connect: () => {
        queueMicrotask(() => {
          for (const event of events) {
            for (const callback of handlers.get("ag_ui_event") ?? []) {
              callback(event);
            }
          }
        });
      },
      disconnect: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    };
  };
};

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
});

describe("ACP Showcase smoke route contract", () => {
  it("follows realtime admission and requires exact fixture text", async () => {
    const response = await runSmoke({
      fetchImpl: vi.fn(async () => admissionResponse()),
      socketFactory: socketFactoryFor(
        { type: "TEXT_MESSAGE_CONTENT", delta: "O" },
        { type: "TEXT_MESSAGE_CONTENT", delta: "K" },
        { type: "RUN_FINISHED", outcome: { type: "success" } },
      ),
    });

    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(response.status).toBe(200);
  });

  it("rejects a terminal error from Gateway replay", async () => {
    const response = await runSmoke({
      fetchImpl: vi.fn(async () => admissionResponse()),
      socketFactory: socketFactoryFor({
        type: "RUN_ERROR",
        message: "relay unavailable",
      }),
    });

    await expect(response.json()).resolves.toMatchObject({
      stage: "run_failed",
      status: "error",
    });
    expect(response.status).toBe(502);
  });

  it("rejects a successful run without the fixture's exact output", async () => {
    const response = await runSmoke({
      fetchImpl: vi.fn(async () => admissionResponse()),
      socketFactory: socketFactoryFor(
        { type: "TEXT_MESSAGE_CONTENT", delta: "not the fixture" },
        { type: "RUN_FINISHED", outcome: { type: "success" } },
      ),
    });

    await expect(response.json()).resolves.toMatchObject({
      stage: "unexpected_output",
      status: "error",
    });
    expect(response.status).toBe(502);
  });
});
