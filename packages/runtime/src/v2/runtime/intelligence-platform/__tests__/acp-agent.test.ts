import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { lastValueFrom, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { AcpAgent } from "../acp-agent";

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

describe("AcpAgent", () => {
  it("admits one paid run and emits durable event pages through AG-UI", async () => {
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi.fn(),
      ɵlistAcpRunEvents: vi
        .fn()
        .mockResolvedValueOnce({
          events: [{ sequence: 7, eventId: "event-7", event: runStarted }],
        })
        .mockResolvedValueOnce({
          events: [{ sequence: 8, eventId: "event-8", event: runFinished }],
        }),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      pollIntervalMs: 0,
    });

    await expect(
      lastValueFrom(agent.run(input).pipe(toArray())),
    ).resolves.toEqual([runStarted, runFinished]);
    expect(platform.ɵadmitAcpRun).toHaveBeenCalledWith({
      agentProfileId: "showcase-codex",
      appUserId: "customer-user-1",
      input,
    });
    expect(platform.ɵlistAcpRunEvents).toHaveBeenNthCalledWith(1, {
      after: 0,
      runId: "run-1",
    });
    expect(platform.ɵlistAcpRunEvents).toHaveBeenNthCalledWith(2, {
      after: 7,
      runId: "run-1",
    });
  });

  it("cancels the exact active run and clones without sharing run state", async () => {
    let acceptCancellation: (() => void) | undefined;
    const cancellationAccepted = new Promise<void>((resolve) => {
      acceptCancellation = resolve;
    });
    const complete = vi.fn();
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 0 }),
      ɵcancelAcpRun: vi.fn(async () => {
        await cancellationAccepted;
        return { accepted: true };
      }),
      ɵlistAcpRunEvents: vi.fn().mockResolvedValue({ events: [] }),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
    });
    const subscription = agent.run(input).subscribe({ complete });
    await vi.waitFor(() =>
      expect(platform.ɵadmitAcpRun).toHaveBeenCalledOnce(),
    );

    agent.abortRun();
    await vi.waitFor(() =>
      expect(platform.ɵcancelAcpRun).toHaveBeenCalledWith({ runId: "run-1" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(complete).not.toHaveBeenCalled();
    acceptCancellation?.();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    subscription.unsubscribe();

    const clone = agent.clone();
    expect(clone).toBeInstanceOf(AcpAgent);
    expect(clone).not.toBe(agent);
  });

  it("starts replay at the admitted cursor and rejects stale event pages", async () => {
    const platform = {
      ɵadmitAcpRun: vi.fn().mockResolvedValue({ cursor: 12 }),
      ɵcancelAcpRun: vi.fn(),
      ɵlistAcpRunEvents: vi.fn().mockResolvedValue({
        events: [{ sequence: 12, eventId: "event-12", event: runStarted }],
      }),
    };
    const agent = new AcpAgent({
      intelligence: platform,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      pollIntervalMs: 0,
    });

    await expect(lastValueFrom(agent.run(input))).rejects.toThrow(
      "event sequence 12 after cursor 12",
    );
    expect(platform.ɵlistAcpRunEvents).toHaveBeenCalledWith({
      after: 12,
      runId: "run-1",
    });
  });

  it("reports streaming and interrupt capabilities", async () => {
    const agent = new AcpAgent({
      intelligence: {
        ɵadmitAcpRun: vi.fn(),
        ɵcancelAcpRun: vi.fn(),
        ɵlistAcpRunEvents: vi.fn(),
      },
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
    });

    await expect(agent.getCapabilities()).resolves.toEqual({
      transport: { streaming: true },
      humanInTheLoop: { interrupts: true },
    });
  });
});
