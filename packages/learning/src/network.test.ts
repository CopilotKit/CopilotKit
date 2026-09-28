import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToRequests } from "./network";

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
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
      undefined,
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
    expect(listener).toHaveBeenCalledWith(
      "/api/save?private",
      "POST",
      "private",
    );
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

  it.each([false, true])(
    "leaves body accessor evaluation to native fetch (inherited: %s)",
    async (inherited) => {
      const body = vi.fn(() => "native body");
      const holder = Object.defineProperty({}, "body", { get: body });
      const init: RequestInit = inherited ? Object.create(holder) : holder;
      let sentBody: BodyInit | null | undefined;
      vi.stubGlobal(
        "fetch",
        (_input: RequestInfo | URL, options?: RequestInit) => {
          sentBody = options?.body;
          return Promise.resolve(new Response());
        },
      );
      const listener = vi.fn();
      cleanup.push(subscribeToRequests(window, listener));
      await window.fetch("/api/save", init);
      expect(body).toHaveBeenCalledTimes(1);
      expect(sentBody).toBe("native body");
      expect(listener).toHaveBeenCalledWith(
        "/api/save",
        "GET",
        expect.any(Symbol),
      );
    },
  );

  it("passes inherited string bodies without reading request stream contents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response())),
    );
    const listener = vi.fn();
    cleanup.push(subscribeToRequests(window, listener));
    await window.fetch(
      "/api/save",
      Object.create({ method: "POST", body: "a string body" }),
    );
    expect(listener).toHaveBeenLastCalledWith(
      "/api/save",
      "POST",
      "a string body",
    );
    const request = new Request("https://example.com/api/save", {
      method: "POST",
      body: "private stream",
    });
    const getter = vi.fn(() => {
      throw new Error("instance body accessor");
    });
    Object.defineProperty(request, "body", { get: getter });
    await window.fetch(request);
    expect(getter).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(
      "https://example.com/api/save",
      "POST",
      expect.any(Symbol),
    );
  });

  it("passes XHR string bodies and keeps non-text bodies opaque", () => {
    const send = vi
      .spyOn(XMLHttpRequest.prototype, "send")
      .mockImplementation(function (this: XMLHttpRequest) {
        this.dispatchEvent(new Event("loadend"));
      });
    const listener = vi.fn(() => vi.fn());
    cleanup.push(subscribeToRequests(window, listener));
    const request = new XMLHttpRequest();
    request.open("POST", "/api/save");
    request.send("string body");
    expect(listener).toHaveBeenLastCalledWith(
      "/api/save",
      "POST",
      "string body",
    );
    expect(send).toHaveBeenLastCalledWith("string body");
    const body = new FormData();
    request.open("POST", "/api/save");
    request.send(body);
    expect(listener).toHaveBeenLastCalledWith(
      "/api/save",
      "POST",
      expect.any(Symbol),
    );
    expect(send).toHaveBeenLastCalledWith(body);
    expect(send.mock.contexts).toEqual([request, request]);
  });

  it("resumes native fetch and body awaits without opening scope while the body is pending", async () => {
    let finishBody!: () => void;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          finishBody = () => {
            controller.enqueue(new TextEncoder().encode('{"saved":true}'));
            controller.close();
          };
        },
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    let active = false;
    let consuming!: () => void;
    const consumptionStarted = new Promise<void>((resolve) => {
      consuming = resolve;
    });
    const complete = vi.fn();
    const resume = vi.fn(() => {
      active = true;
      queueMicrotask(() => {
        active = false;
      });
    });
    cleanup.push(
      subscribeToRequests(window, () => ({
        complete,
        resume,
        canContinue: () => active,
      })),
    );
    const application = (async () => {
      const result = await window.fetch("/api/save");
      expect(active).toBe(true);
      expect(result).toBe(response);
      expect(result.bodyUsed).toBe(false);
      const body = result.json();
      consuming();
      const parsed = await body;
      expect(active).toBe(true);
      return parsed;
    })();
    await consumptionStarted;
    expect(active).toBe(false);
    expect(resume).toHaveBeenCalledTimes(1);
    finishBody();
    await expect(application).resolves.toEqual({ saved: true });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("returns the original body promise and preserves body method receiver and arguments", async () => {
    const response = new Response("unread");
    const promise = Promise.resolve("native text");
    const original = vi
      .spyOn(Response.prototype, "text")
      .mockReturnValue(promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const resume = vi.fn();
    cleanup.push(
      subscribeToRequests(window, () => ({
        complete: vi.fn(),
        resume,
        canContinue: () => true,
      })),
    );
    const result = await window.fetch("/api/save");
    const argument = {};
    expect(Reflect.apply(result.text, result, [argument])).toBe(promise);
    expect(original).toHaveBeenCalledWith(argument);
    expect(original.mock.contexts[0]).toBe(response);
    expect(await promise).toBe("native text");
    expect(response.bodyUsed).toBe(false);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("does not arm delayed consumption or untracked responses", async () => {
    const response = new Response('{"saved":true}');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const resume = vi.fn();
    cleanup.push(
      subscribeToRequests(window, () => ({
        complete: vi.fn(),
        resume,
        canContinue: () => false,
      })),
    );
    const result = await window.fetch("/api/save");
    await expect(result.json()).resolves.toEqual({ saved: true });
    await expect(new Response("untracked").text()).resolves.toBe("untracked");
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("resumes stale fetch continuations and already-armed body continuations without rechecking eligibility", async () => {
    let eligible = true;
    let resolveBody!: (value: string) => void;
    const body = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });
    vi.spyOn(Response.prototype, "text").mockReturnValue(body);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    const resume = vi.fn();
    const canContinue = vi.fn(() => eligible);
    cleanup.push(
      subscribeToRequests(window, () => ({
        complete: vi.fn(),
        resume,
        canContinue,
      })),
    );
    const response = await window.fetch("/api/save");
    const result = response.text();
    eligible = false;
    resolveBody("saved");
    await result;
    expect(resume).toHaveBeenCalledTimes(2);
    await window.fetch("/api/stale");
    expect(resume).toHaveBeenCalledTimes(3);
    expect(canContinue).toHaveBeenCalledTimes(1);
  });

  it("preserves body failures without opening a continuation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid json")),
    );
    const resume = vi.fn();
    cleanup.push(
      subscribeToRequests(window, () => ({
        complete: vi.fn(),
        resume,
        canContinue: () => true,
      })),
    );
    const response = await window.fetch("/api/save");
    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("restores shared body wrappers and makes wrappers retained by later instrumentation inert", async () => {
    const original = Response.prototype.text;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("saved")));
    const resume = vi.fn();
    const first = subscribeToRequests(window, () => ({
      complete: vi.fn(),
      resume,
      canContinue: () => true,
    }));
    const patched = Response.prototype.text;
    const second = subscribeToRequests(window, () => undefined);
    cleanup.push(first, second);
    const response = await window.fetch("/api/save");
    first();
    expect(Response.prototype.text).toBe(patched);
    const later = function (this: Response) {
      return patched.call(this);
    };
    Response.prototype.text = later;
    second();
    expect(Response.prototype.text).toBe(later);
    await expect(response.text()).resolves.toBe("saved");
    expect(resume).toHaveBeenCalledTimes(1);
    Response.prototype.text = original;
  });

  it("suppresses body continuation after final unsubscribe", async () => {
    let resolveBody!: (value: string) => void;
    const promise = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });
    const original = vi
      .spyOn(Response.prototype, "text")
      .mockReturnValue(promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    const resume = vi.fn();
    const stop = subscribeToRequests(window, () => ({
      complete: vi.fn(),
      resume,
      canContinue: () => true,
    }));
    cleanup.push(stop);
    const response = await window.fetch("/api/save");
    const body = response.text();
    stop();
    expect(Response.prototype.text).toBe(original);
    resolveBody("saved");
    await body;
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
