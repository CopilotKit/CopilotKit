import { describe, it, expect, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import {
  BuiltInAgent,
  createDefaultInput,
  collectEventsIncludingErrors,
} from "./agent-test-helpers";
import type { AgentFactoryContext } from "./agent-test-helpers";

function agentWith(
  body: (ctx: AgentFactoryContext) => AsyncGenerator<BaseEvent>,
) {
  return new BuiltInAgent({ type: "custom", factory: body });
}

describe("ctx.onRunEnd", () => {
  it("runs cleanup once after a run that finishes", async () => {
    const cleanup = vi.fn();
    const agent = agentWith(async function* (ctx) {
      ctx.onRunEnd(cleanup);
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId: "m1",
        delta: "hi",
      } as BaseEvent;
    });

    const { errored } = await collectEventsIncludingErrors(
      agent.run(createDefaultInput()),
    );

    expect(errored).toBe(false);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  });

  it("runs cleanup after a run that fails", async () => {
    const cleanup = vi.fn();
    const agent = agentWith(async function* (ctx) {
      ctx.onRunEnd(cleanup);
      yield* [];
      throw new Error("model down");
    });

    const { errored } = await collectEventsIncludingErrors(
      agent.run(createDefaultInput()),
    );

    expect(errored).toBe(true);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  });

  it("runs cleanup after a run that pauses on an interrupt", async () => {
    const cleanup = vi.fn();
    const agent = agentWith(async function* (ctx) {
      ctx.onRunEnd(cleanup);
      yield* [];
      await ctx.interrupt([{ id: "i1", reason: "confirm" }]);
    });

    const { events } = await collectEventsIncludingErrors(
      agent.run(createDefaultInput()),
    );

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt" },
    });
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  });

  it("runs cleanup after an aborted run", async () => {
    const cleanup = vi.fn();
    const started = vi.fn();
    const agent = agentWith(async function* (ctx) {
      ctx.onRunEnd(cleanup);
      started();
      await new Promise<void>((resolve) =>
        ctx.abortSignal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      yield* [];
      ctx.abortSignal.throwIfAborted();
    });

    const subscription = agent.run(createDefaultInput()).subscribe({});
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    agent.abortRun();
    subscription.unsubscribe();

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  });

  it("logs a failing cleanup and still runs the next one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    const agent = agentWith(async function* (ctx) {
      ctx.onRunEnd(() => {
        throw new Error("close failed");
      });
      ctx.onRunEnd(second);
      yield* [];
    });

    const { errored } = await collectEventsIncludingErrors(
      agent.run(createDefaultInput()),
    );

    expect(errored).toBe(false);
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith(
      "[CopilotKit] BuiltInAgent run cleanup failed:",
      expect.objectContaining({ message: "close failed" }),
    );
    error.mockRestore();
  });
});
