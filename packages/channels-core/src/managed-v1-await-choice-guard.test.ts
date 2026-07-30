import { expect, test } from "vitest";
import { Section } from "@copilotkit/channels-ui";
import { createChannel } from "./create-channel.js";
import type { Thread } from "./thread.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

class NonBlockingManagedAdapter extends FakeAdapter {
  readonly __intelligenceChannel = true;

  constructor() {
    super({ platform: "intelligence" });
    this.capabilities.supportsBlockingChoice = false;
  }
}

async function setupNonBlockingManagedThread() {
  const adapter = new NonBlockingManagedAdapter();
  const channel = createChannel({ adapters: [adapter] });
  let thread: Pick<Thread, "awaitChoice"> | undefined;
  channel.onThreadStarted(({ thread: activeThread }) => {
    thread = activeThread;
  });
  await channel.ɵruntime.start();
  await adapter.emitThreadStarted();
  if (!thread) {
    throw new Error("Managed thread was not created");
  }

  return {
    adapter,
    thread,
    teardown: () => channel.ɵruntime.stop(),
  };
}

test("managed awaitChoice fails fast before registering or posting a picker", async () => {
  const { adapter, thread, teardown } = await setupNonBlockingManagedThread();

  try {
    const outcome = await Promise.race([
      thread.awaitChoice(Section({ children: "Choose" })).then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      ),
      new Promise<{ status: "pending" }>((resolve) => {
        setTimeout(() => resolve({ status: "pending" }), 0);
      }),
    ]);

    expect(outcome).toMatchObject({
      status: "rejected",
      error: {
        name: "ChannelAwaitChoiceNotSupportedError",
        code: "channel_await_choice_not_supported",
        message: expect.stringContaining("Thread.resume()"),
      },
    });
    expect(adapter.posted).toHaveLength(0);
  } finally {
    await teardown();
  }
});
