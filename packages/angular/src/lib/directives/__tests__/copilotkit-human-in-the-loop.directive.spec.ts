import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HumanInTheLoop } from "../../human-in-the-loop";

describe("HumanInTheLoop service", () => {
  let service: HumanInTheLoop;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [HumanInTheLoop] });
    service = TestBed.inject(HumanInTheLoop);
  });

  it("resolves when matching result is provided", async () => {
    const promise = service.onResult("call-1", "approval");
    service.addResult("call-1", "approval", { status: "ok" });

    await expect(promise).resolves.toEqual({ status: "ok" });
  });

  it("ignores non-matching results until criteria matches", async () => {
    const promise = service.onResult("call-2", "verify");

    service.addResult("call-2", "other", "nope");

    const race = Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);

    await expect(race).resolves.toBe("pending");

    service.addResult("call-2", "verify", "ok");
    await expect(promise).resolves.toBe("ok");
  });

  it("does not leak the bus routing keys into the resolved result", async () => {
    const promise = service.onResult("call-3", "request_page_oncall");
    service.addResult("call-3", "request_page_oncall", { approved: true });

    const resolved = await promise;

    // A leaked envelope makes an agent read the answer as
    // {toolName, result} instead of {approved: true}, so a gate keyed on
    // `approved` silently never fires.
    expect(resolved).not.toHaveProperty("toolName");
    expect(resolved).not.toHaveProperty("toolCallId");
    expect(resolved).toEqual({ approved: true });
  });
  it.each([false, true])(
    "rejects and unsubscribes on abort (already aborted: %s)",
    async (alreadyAborted) => {
      const controller = new AbortController();
      if (alreadyAborted) controller.abort();
      const promise = service.onResult("call-1", "approval", controller.signal);
      const rejected = expect(promise).rejects.toThrow(
        "Human-in-the-loop interaction aborted",
      );
      controller.abort();
      await rejected;
      expect(service.results.observed).toBe(false);
    },
  );

  it("detaches cancellation after receiving an answer", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const promise = service.onResult("call-1", "approval", controller.signal);
    service.addResult("call-1", "approval", "yes");
    await expect(promise).resolves.toBe("yes");
    expect(service.results.observed).toBe(false);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
  });

  it("rejects if the result stream closes without an answer", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const promise = service.onResult("call-1", "approval", controller.signal);
    const rejected = expect(promise).rejects.toThrow("no elements in sequence");
    service.results.complete();
    await rejected;
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("keeps other waiters answerable when one aborts", async () => {
    const controller = new AbortController();
    const canceled = service.onResult("call-1", "approval", controller.signal);
    const active = service.onResult("call-2", "approval");
    const rejected = expect(canceled).rejects.toThrow(
      "Human-in-the-loop interaction aborted",
    );
    controller.abort();
    await rejected;
    service.addResult("call-1", "approval", "stale");
    service.addResult("call-2", "approval", "yes");
    await expect(active).resolves.toBe("yes");
    expect(service.results.observed).toBe(false);
  });
});
