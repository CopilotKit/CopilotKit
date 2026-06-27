import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

describe("ProxiedCopilotRuntimeAgent - detachActiveRun timeout guard", () => {
  let agent: ProxiedCopilotRuntimeAgent;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    agent = new ProxiedCopilotRuntimeAgent({
      agentId: "test-agent",
      runtimeUrl: "http://localhost:8000",
    });
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("should timeout and continue when delegate.detachActiveRun() never resolves", async () => {
    vi.useFakeTimers();

    // Mock delegate that returns a never-resolving promise
    const mockDelegate = {
      detachActiveRun: vi.fn(
        () =>
          new Promise<void>(() => {
            // Never resolves
          }),
      ),
    };
    agent["delegate"] = mockDelegate as any;

    // Mock super.detachActiveRun to return a resolving promise
    const originalDetach = Object.getPrototypeOf(
      Object.getPrototypeOf(agent),
    ).detachActiveRun;
    vi.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(agent)),
      "detachActiveRun",
      "get",
    ).mockReturnValue(
      vi.fn(() => Promise.resolve()),
    );

    const detachPromise = agent.detachActiveRun();

    // Fast-forward through the 5s timeout
    await vi.advanceTimersByTimeAsync(5_000);

    // Should complete without hanging
    await expect(detachPromise).resolves.toBeUndefined();

    // Should have warned about the timeout
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("delegate.detachActiveRun()"),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("timed out after 5000ms"),
    );

    vi.useRealTimers();
  });

  it("should timeout and continue when super.detachActiveRun() never resolves", async () => {
    vi.useFakeTimers();

    // No delegate set (so delegate branch is skipped)
    agent["delegate"] = undefined;

    // Mock the superclass detachActiveRun to return a never-resolving promise
    const originalProto = Object.getPrototypeOf(
      Object.getPrototypeOf(agent),
    );
    const originalDetach = originalProto.detachActiveRun;
    originalProto.detachActiveRun = vi.fn(
      () =>
        new Promise<void>(() => {
          // Never resolves
        }),
    );

    const detachPromise = agent.detachActiveRun();

    // Fast-forward through the 5s timeout
    await vi.advanceTimersByTimeAsync(5_000);

    // Should complete without hanging
    await expect(detachPromise).resolves.toBeUndefined();

    // Should have warned about the timeout
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("super.detachActiveRun()"),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("timed out after 5000ms"),
    );

    // Restore the original
    originalProto.detachActiveRun = originalDetach;

    vi.useRealTimers();
  });

  it("should reset isRunning to false after detach", async () => {
    vi.useFakeTimers();

    agent["delegate"] = undefined;
    agent.isRunning = true;

    // Mock super.detachActiveRun to return a resolving promise
    const originalProto = Object.getPrototypeOf(
      Object.getPrototypeOf(agent),
    );
    originalProto.detachActiveRun = vi.fn(() => Promise.resolve());

    await agent.detachActiveRun();

    expect(agent.isRunning).toBe(false);

    vi.useRealTimers();
  });

  it("should reset isRunning even after timeout", async () => {
    vi.useFakeTimers();

    agent["delegate"] = undefined;
    agent.isRunning = true;

    // Mock super.detachActiveRun to never resolve
    const originalProto = Object.getPrototypeOf(
      Object.getPrototypeOf(agent),
    );
    originalProto.detachActiveRun = vi.fn(
      () =>
        new Promise<void>(() => {
          // Never resolves
        }),
    );

    const detachPromise = agent.detachActiveRun();

    // Fast-forward through the 5s timeout
    await vi.advanceTimersByTimeAsync(5_000);

    await detachPromise;

    expect(agent.isRunning).toBe(false);

    vi.useRealTimers();
  });

  it("should complete successfully when both delegate and super resolve within timeout", async () => {
    vi.useFakeTimers();

    const mockDelegate = {
      detachActiveRun: vi.fn(() => Promise.resolve()),
    };
    agent["delegate"] = mockDelegate as any;

    const originalProto = Object.getPrototypeOf(
      Object.getPrototypeOf(agent),
    );
    originalProto.detachActiveRun = vi.fn(() => Promise.resolve());

    agent.isRunning = true;

    const detachPromise = agent.detachActiveRun();

    // Advance slightly — promises should resolve immediately
    await vi.advanceTimersByTimeAsync(100);

    await expect(detachPromise).resolves.toBeUndefined();

    // Should not have warned about timeouts
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    expect(agent.isRunning).toBe(false);

    vi.useRealTimers();
  });
});
