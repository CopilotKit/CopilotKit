import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { lastValueFrom, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { AcpAgent } from "../acp-agent";
import { AcpRunStreamError } from "../client";
import type { AcpStoredEvent } from "../client";

const input: RunAgentInput = {
  threadId: "thread-1",
  runId: "run-1",
  state: {},
  messages: [{ id: "user-1", role: "user", content: "Hello" }],
  tools: [],
  context: [],
  forwardedProps: {},
};

const runStarted: BaseEvent = {
  type: EventType.RUN_STARTED,
  threadId: "thread-1",
  runId: "run-1",
};

const runFinished: BaseEvent = {
  type: EventType.RUN_FINISHED,
  threadId: "thread-1",
  runId: "run-1",
  outcome: { type: "success" },
};

const eventStream = (
  events: readonly AcpStoredEvent[],
): AsyncIterable<AcpStoredEvent> => ({
  async *[Symbol.asyncIterator]() {
    yield* events;
  },
});

const waitForAbort = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );

describe("AcpAgent", () => {
  it("reconnects from the last durable cursor and emits AG-UI events once", async () => {
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi.fn(),
      ɵstreamAcpRunEvents: vi
        .fn()
        .mockReturnValueOnce(
          eventStream([{ sequence: 7, eventId: "event-7", event: runStarted }]),
        )
        .mockReturnValueOnce(
          eventStream([
            { sequence: 8, eventId: "event-8", event: runFinished },
          ]),
        ),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      reconnectDelayMs: 0,
    });

    await expect(
      lastValueFrom(agent.run(input).pipe(toArray())),
    ).resolves.toEqual([runStarted, runFinished]);
    expect(platform.ɵadmitAcpRun).toHaveBeenCalledWith({
      agentProfileId: "showcase-codex",
      appUserId: "customer-user-1",
      input,
    });
    expect(platform.ɵstreamAcpRunEvents).toHaveBeenNthCalledWith(1, {
      after: 0,
      runId: "run-1",
      signal: expect.any(AbortSignal),
    });
    expect(platform.ɵstreamAcpRunEvents).toHaveBeenNthCalledWith(2, {
      after: 7,
      runId: "run-1",
      signal: expect.any(AbortSignal),
    });
  });

  it("cancels durably before aborting the live stream", async () => {
    let acceptCancellation: (() => void) | undefined;
    const cancellationAccepted = new Promise<void>((resolve) => {
      acceptCancellation = resolve;
    });
    let streamSignal: AbortSignal | undefined;
    const complete = vi.fn();
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi.fn(async () => {
        await cancellationAccepted;
        return { accepted: true };
      }),
      ɵstreamAcpRunEvents: vi.fn(
        ({
          signal,
        }: {
          signal: AbortSignal;
        }): AsyncIterable<AcpStoredEvent> => ({
          async *[Symbol.asyncIterator]() {
            streamSignal = signal;
            await waitForAbort(signal);
          },
        }),
      ),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
    });
    const subscription = agent.run(input).subscribe({ complete });
    await vi.waitFor(() => expect(streamSignal).toBeDefined());

    agent.abortRun();
    await vi.waitFor(() =>
      expect(platform.ɵcancelAcpRun).toHaveBeenCalledWith({ runId: "run-1" }),
    );
    expect(streamSignal?.aborted).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    acceptCancellation?.();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(streamSignal?.aborted).toBe(true);
    subscription.unsubscribe();

    const clone = agent.clone();
    expect(clone).toBeInstanceOf(AcpAgent);
    expect(clone).not.toBe(agent);
  });

  it("keeps the stream live when durable cancellation is rejected", async () => {
    let streamSignal: AbortSignal | undefined;
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
      ɵstreamAcpRunEvents: vi.fn(
        ({
          signal,
        }: {
          signal: AbortSignal;
        }): AsyncIterable<AcpStoredEvent> => ({
          async *[Symbol.asyncIterator]() {
            streamSignal = signal;
            await waitForAbort(signal);
          },
        }),
      ),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
    });
    const subscription = agent.run(input).subscribe();
    await vi.waitFor(() => expect(streamSignal).toBeDefined());

    agent.abortRun();
    await vi.waitFor(() =>
      expect(platform.ɵcancelAcpRun).toHaveBeenCalledOnce(),
    );

    expect(streamSignal?.aborted).toBe(false);
    agent.abortRun();
    await vi.waitFor(() =>
      expect(platform.ɵcancelAcpRun).toHaveBeenCalledTimes(2),
    );
    subscription.unsubscribe();
  });

  it("keeps the stream live when Intelligence does not accept cancellation", async () => {
    let streamSignal: AbortSignal | undefined;
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi.fn().mockResolvedValue({ accepted: false }),
      ɵstreamAcpRunEvents: vi.fn(
        ({
          signal,
        }: {
          signal: AbortSignal;
        }): AsyncIterable<AcpStoredEvent> => ({
          async *[Symbol.asyncIterator]() {
            streamSignal = signal;
            await waitForAbort(signal);
          },
        }),
      ),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
    });
    const subscription = agent.run(input).subscribe();
    await vi.waitFor(() => expect(streamSignal).toBeDefined());

    agent.abortRun();
    await vi.waitFor(() =>
      expect(platform.ɵcancelAcpRun).toHaveBeenCalledOnce(),
    );

    expect(streamSignal?.aborted).toBe(false);
    agent.abortRun();
    await vi.waitFor(() =>
      expect(platform.ɵcancelAcpRun).toHaveBeenCalledTimes(2),
    );
    subscription.unsubscribe();
  });

  it("rejects stale streamed events without reconnecting", async () => {
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 12 }),
      ɵcancelAcpRun: vi.fn(),
      ɵstreamAcpRunEvents: vi
        .fn()
        .mockReturnValue(
          eventStream([
            { sequence: 12, eventId: "event-12", event: runStarted },
          ]),
        ),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      reconnectDelayMs: 0,
    });

    await expect(lastValueFrom(agent.run(input))).rejects.toThrow(
      "event sequence 12 after cursor 12",
    );
    expect(platform.ɵstreamAcpRunEvents).toHaveBeenCalledOnce();
  });

  it("retries only stream failures marked retryable", async () => {
    const retryable = {
      async *[Symbol.asyncIterator](): AsyncIterator<AcpStoredEvent> {
        throw new AcpRunStreamError("listener reconnecting", true);
      },
    };
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi.fn(),
      ɵstreamAcpRunEvents: vi
        .fn()
        .mockReturnValueOnce(retryable)
        .mockReturnValueOnce(
          eventStream([
            { sequence: 1, eventId: "event-1", event: runFinished },
          ]),
        ),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      reconnectDelayMs: 0,
    });

    await expect(lastValueFrom(agent.run(input))).resolves.toEqual(runFinished);
    expect(platform.ɵstreamAcpRunEvents).toHaveBeenCalledTimes(2);
  });

  it("reports streaming and interrupt capabilities", async () => {
    const agent = new AcpAgent({
      intelligence: {
        ɵadmitAcpRun: vi.fn(),
        ɵcancelAcpRun: vi.fn(),
        ɵstreamAcpRunEvents: vi.fn(),
      },
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
    });

    await expect(agent.getCapabilities()).resolves.toEqual({
      transport: { streaming: true },
      humanInTheLoop: { interrupts: true },
    });
  });

  it("accepts an immediate resume run after the interrupt run completes", async () => {
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi.fn(),
      ɵstreamAcpRunEvents: vi.fn(({ runId }: { runId: string }) =>
        eventStream([
          {
            sequence: 1,
            eventId: `event-${runId}`,
            event: {
              ...runFinished,
              runId,
              outcome:
                runId === "run-1"
                  ? {
                      type: "interrupt" as const,
                      interrupts: [{ id: "permission-1", value: {} }],
                    }
                  : { type: "success" as const },
            },
          },
        ]),
      ),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
    });

    await lastValueFrom(agent.run(input));
    await expect(
      lastValueFrom(agent.run({ ...input, runId: "run-2" })),
    ).resolves.toMatchObject({ type: EventType.RUN_FINISHED, runId: "run-2" });
  });
});
