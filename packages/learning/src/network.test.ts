import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToRequests } from "./network";

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
});

describe("request instrumentation", () => {
  it.each([false, true])(
    "does not evaluate RequestInit method accessors before native fetch (inherited: %s)",
    async (inherited) => {
      let reads = 0;
      let sentMethod: string | undefined;
      const holder = {
        get method() {
          reads += 1;
          return reads === 1 ? "POST" : "DELETE";
        },
      };
      const init: RequestInit = inherited ? Object.create(holder) : holder;
      vi.stubGlobal(
        "fetch",
        (_url: RequestInfo | URL, options?: RequestInit) => {
          sentMethod = options?.method;
          return Promise.resolve(new Response());
        },
      );
      const listener = vi.fn();
      cleanup.push(subscribeToRequests(window, listener));
      await window.fetch("/api/save", init);
      expect(reads).toBe(1);
      expect(sentMethod).toBe("POST");
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it("uses native URL metadata without evaluating an overridden instance getter", async () => {
    const input = new URL("https://example.com/api/save");
    const read = vi.fn(() => {
      throw new Error("custom getter");
    });
    Object.defineProperty(input, "href", { get: read });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    const listener = vi.fn();
    cleanup.push(subscribeToRequests(window, listener));
    await window.fetch(input);
    expect(read).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(
      "https://example.com/api/save",
      "GET",
    );
  });
  it("returns the original fetch promise, response and arguments and preserves this", async () => {
    const response = new Response("private body", { status: 201 });
    const promise = Promise.resolve(response);
    const original = vi.fn(() => promise);
    vi.stubGlobal("fetch", original);
    const done = vi.fn();
    const listener = vi.fn(() => done);
    cleanup.push(subscribeToRequests(window, listener));
    const init = {
      method: "POST",
      body: "private",
      headers: { Authorization: "private" },
    };
    const result = window.fetch("/api/save?private", init);
    expect(result).toBe(promise);
    expect(await result).toBe(response);
    expect(original).toHaveBeenCalledWith("/api/save?private", init);
    expect(original.mock.contexts[0]).toBe(window);
    expect(response.bodyUsed).toBe(false);
    expect(listener).toHaveBeenCalledWith("/api/save?private", "POST");
    expect(done).toHaveBeenCalledWith({ status: 201, outcome: "success" });
  });

  it("preserves rejection and synchronous throw while reporting the failure", async () => {
    const aborted = new DOMException("Stopped", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    const done = vi.fn();
    const stop = subscribeToRequests(window, () => done);
    cleanup.push(stop);
    await expect(window.fetch("/api/save")).rejects.toBe(aborted);
    expect(done).toHaveBeenCalledWith({ outcome: "aborted" });
    stop();
    const failure = new Error("sync");
    vi.stubGlobal("fetch", () => {
      throw failure;
    });
    cleanup.push(subscribeToRequests(window, () => done));
    expect(() => window.fetch("/api/save")).toThrow(failure);
    expect(done).toHaveBeenLastCalledWith({ outcome: "error" });
  });

  it("shares wrappers across subscriptions and safely restores them", async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", originalFetch);
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeToRequests(window, () => first);
    cleanup.push(stopFirst);
    const wrapper = window.fetch;
    const stopSecond = subscribeToRequests(window, () => second);
    cleanup.push(stopSecond);
    expect(window.fetch).toBe(wrapper);
    stopFirst();
    await window.fetch("/api/save");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
    expect(window.fetch).toBe(originalFetch);
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);
  });

  it("does not overwrite later instrumentation or duplicate events after restarting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    const stop = subscribeToRequests(window, () => vi.fn());
    cleanup.push(stop);
    const inner = window.fetch;
    const laterWrapper: typeof fetch = (...args) => inner(...args);
    window.fetch = laterWrapper;
    stop();
    expect(window.fetch).toBe(laterWrapper);
    const done = vi.fn();
    const stopAgain = subscribeToRequests(window, () => done);
    cleanup.push(stopAgain);
    await window.fetch("/api/save");
    expect(done).toHaveBeenCalledTimes(1);
    stopAgain();
    expect(window.fetch).toBe(laterWrapper);
  });

  it("suppresses completion after unsubscribe and isolates callback errors", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const done = vi.fn();
    const stop = subscribeToRequests(window, () => done);
    const promise = window.fetch("/api/save");
    stop();
    resolve(new Response());
    await promise;
    expect(done).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    cleanup.push(
      subscribeToRequests(window, () => () => {
        throw new Error("observer");
      }),
    );
    await expect(window.fetch("/api/save")).resolves.toBeInstanceOf(Response);
  });
});
