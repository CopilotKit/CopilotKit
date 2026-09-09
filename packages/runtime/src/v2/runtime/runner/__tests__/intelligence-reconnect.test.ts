import { AbstractAgent } from "@ag-ui/client";
import { Socket } from "phoenix";
import { EMPTY } from "rxjs";
import { expect, test, vi } from "vitest";
import { IntelligenceAgentRunner } from "../intelligence";

class IdleAgent extends AbstractAgent {
  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
}

/** Capture the real Phoenix join payload without opening a network connection. */
function setup() {
  const connect = vi
    .spyOn(Socket.prototype, "connect")
    .mockImplementation(() => {});
  const channel = vi.spyOn(Socket.prototype, "channel");
  const onClose = vi.spyOn(Socket.prototype, "onClose");
  const runner = new IntelligenceAgentRunner({
    url: "ws://localhost:4000/runner",
  });
  const subscription = runner
    .run({
      threadId: "thread-reconnect",
      agent: new IdleAgent(),
      input: {
        threadId: "thread-reconnect",
        runId: "run-reconnect",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      },
    })
    .subscribe();
  return {
    channel,
    connect,
    subscription,
    close: onClose.mock.calls[0][0],
    teardown() {
      subscription.unsubscribe();
      onClose.mockRestore();
      channel.mockRestore();
      connect.mockRestore();
    },
  };
}

test("runner advertises reconnect support so a transport close does not terminalize the run", () => {
  const { channel, teardown } = setup();
  try {
    expect(channel).toHaveBeenCalledWith("ingestion:run-reconnect", {
      thread_id: "thread-reconnect",
      run_id: "run-reconnect",
      capabilities: ["runner_reconnect_v1"],
    });
  } finally {
    teardown();
  }
});

/** Build the browser close event shape without requiring a browser global. */
function normalClose(): CloseEvent {
  return Object.assign(new Event("close"), {
    code: 1000,
    reason: "",
    wasClean: true,
  });
}

test("an unexpected normal close reconnects an active runner", async () => {
  vi.useFakeTimers();
  const { connect, close, teardown } = setup();
  try {
    await close(normalClose());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connect).toHaveBeenCalledTimes(2);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("intentional runner teardown cancels a pending normal-close reconnect", async () => {
  vi.useFakeTimers();
  const { connect, close, subscription, teardown } = setup();
  try {
    await close(normalClose());
    subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(1_000);
    await close(normalClose());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connect).toHaveBeenCalledTimes(1);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});
