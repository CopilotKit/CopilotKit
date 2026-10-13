import { afterEach, describe, expect, it, vi } from "vitest";
import { installNetworkCapture } from "../network";
import type { BodySnapshot } from "../network-body";

interface Captured {
  name: string;
  value: {
    transport: string;
    method: string;
    url: string;
    route: string;
    origin: string;
    status: number | null;
    outcome: string;
    durationMs: number;
    completedAt: number;
    request: { headers: Record<string, string>; body: BodySnapshot };
    response: {
      url?: string;
      headers: Record<string, string>;
      body: BodySnapshot;
    };
    framework?: unknown;
  };
}
const PAGE_ORIGIN = "http://localhost:3000";
const realFetch = globalThis.fetch;
let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});
function setup(fakeFetch: typeof fetch, ignoreUrls: (string | RegExp)[] = []) {
  globalThis.fetch = fakeFetch;
  const events: Captured[] = [];
  uninstall = installNetworkCapture({
    emit: (name, value) => events.push({ name, value } as Captured),
    routes: ["/api/deals/:id"],
    ignoreUrls,
  });
  return events;
}
function respondWith(status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response("response text", {
        status,
        headers: { "content-type": "text/plain" },
      }),
  );
}
async function captured(events: Captured[], count = 1) {
  await vi.waitFor(() => expect(events).toHaveLength(count));
  return events[count - 1]!.value;
}
async function microtasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("fetch capture", () => {
  it("captures full URL, headers and bodies while returning the identical Promise and Response", async () => {
    const nativeResponse = new Response('{"saved":true}', {
      status: 201,
      headers: { "Content-Type": "application/json", "X-Result": "full-value" },
    });
    const originalPromise = Promise.resolve(nativeResponse);
    const nativeFetch = vi.fn<typeof fetch>(() => originalPromise);
    const events = setup(nativeFetch);
    const init = {
      method: "POST",
      headers: {
        Authorization: "Bearer visible",
        "Content-Type": "application/json",
      },
      body: '{"email":"alice@example.com"}',
    };
    const promise = fetch("/api/deals/42?token=secret#fragment", init);
    expect(promise).toBe(originalPromise);
    expect(nativeFetch).toHaveBeenCalledWith(
      "/api/deals/42?token=secret#fragment",
      init,
    );
    const response = await promise;
    expect(response).toBe(nativeResponse);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('{"saved":true}');
    const event = await captured(events);
    expect(event).toMatchObject({
      transport: "fetch",
      method: "POST",
      url: `${PAGE_ORIGIN}/api/deals/42?token=[redacted]#fragment`,
      origin: PAGE_ORIGIN,
      route: "/api/deals/42",
      status: 201,
      outcome: "ok",
      request: {
        headers: {
          authorization: "[redacted]",
          "content-type": "application/json",
        },
        body: { status: "complete", text: init.body, encoding: "utf-8" },
      },
      response: {
        headers: {
          "content-type": "application/json",
          "x-result": "full-value",
        },
        body: { status: "complete", text: '{"saved":true}' },
      },
    });
    expect(typeof event.durationMs).toBe("number");
  });

  it("clones a Request body without consuming it and honors init overrides", async () => {
    const requests: string[] = [];
    const events = setup(
      vi.fn<typeof fetch>(async (input, init) => {
        const request = input as Request;
        requests.push(init?.body ? String(init.body) : await request.text());
        return new Response("ok");
      }),
    );
    const request = new Request("https://api.example.com/orders/9?full=1", {
      method: "POST",
      headers: { "X-Token": "full" },
      body: "original body",
    });
    await fetch(request);
    await fetch(
      new Request("https://api.example.com/orders/10", {
        method: "POST",
        body: "ignored original",
      }),
      {
        method: "PATCH",
        body: "replacement",
        headers: { "X-Override": "yes" },
      },
    );
    await captured(events, 2);
    expect(requests).toEqual(["original body", "replacement"]);
    expect(events[0]!.value.request).toMatchObject({
      headers: { "x-token": "[redacted]" },
      body: { text: "original body" },
    });
    expect(events[1]!.value).toMatchObject({
      method: "PATCH",
      route: "/orders/10",
      request: {
        headers: { "x-override": "yes" },
        body: { text: "replacement" },
      },
    });
  });

  it("captures framework requests normally without categorizing or hiding their headers/query", async () => {
    const events = setup(respondWith());
    await fetch("/learning/deals/1?_rsc=abc", {
      headers: { RSC: "1", "Next-Action": "a1b2" },
    });
    const event = await captured(events);
    expect(event.url).toBe(`${PAGE_ORIGIN}/learning/deals/1?_rsc=abc`);
    expect(event.request.headers).toEqual({ "next-action": "a1b2", rsc: "1" });
    expect(event).not.toHaveProperty("framework");
  });

  it("skips only configured URLs and handles global regexes consistently", async () => {
    const native = respondWith();
    const events = setup(native, ["/api/learning-events", /copilotkit/g]);
    await fetch("/api/learning-events?full=1");
    await fetch("https://runtime.example.com/copilotkit/run");
    await fetch("https://runtime.example.com/copilotkit/run");
    await microtasks();
    expect(events).toEqual([]);
    expect(native).toHaveBeenCalledTimes(3);
  });

  it("preserves exact errors, including a synchronous throw, while retaining request metadata", async () => {
    const abort = new DOMException("stopped", "AbortError");
    const offline = new TypeError("Failed to fetch");
    const sync = new Error("sync");
    const native = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(abort)
      .mockRejectedValueOnce(offline)
      .mockImplementationOnce(() => {
        throw sync;
      });
    const events = setup(native);
    await expect(
      fetch("/a", { method: "POST", body: "submitted" }),
    ).rejects.toBe(abort);
    await expect(fetch("/b")).rejects.toBe(offline);
    expect(() => fetch("/c")).toThrow(sync);
    await captured(events, 3);
    expect(events.map(({ value }) => [value.outcome, value.status])).toEqual([
      ["aborted", null],
      ["error", null],
      ["error", null],
    ]);
    expect(events[0]!.value.request.body.text).toBe("submitted");
    expect(events[0]!.value.response.body).toEqual({
      status: "unavailable",
      reason: "no-response",
    });
    expect(native).toHaveBeenCalledTimes(3);
  });

  it("does not call an ignored synchronously throwing fetch twice", () => {
    const error = new Error("native error");
    const native = vi.fn<typeof fetch>(() => {
      throw error;
    });
    setup(native, ["/ignored"]);
    expect(() => fetch("/ignored")).toThrow(error);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("bounds request/response fields in JSON bytes and keeps Unicode boundaries intact", async () => {
    const text = '🙂\\\n"'.repeat(3000);
    const events = setup(
      vi.fn<typeof fetch>(
        async () =>
          new Response(text, { headers: { "content-type": "text/plain" } }),
      ),
    );
    const response = await fetch("/large", { method: "POST", body: text });
    expect(await response.text()).toBe(text);
    const event = await captured(events);
    for (const body of [event.request.body, event.response.body]) {
      expect(body.status).toBe("truncated");
      expect(
        new TextEncoder().encode(JSON.stringify(body)).length,
      ).toBeLessThanOrEqual(4096);
      expect(body.text).not.toContain("�");
      expect(text.startsWith(body.text!)).toBe(true);
    }
  });

  it("captures binary body prefixes as base64 and does not alter caller bytes", async () => {
    const bytes = new Uint8Array(6000).fill(255);
    const events = setup(
      vi.fn<typeof fetch>(
        async () =>
          new Response(bytes, {
            headers: { "content-type": "application/octet-stream" },
          }),
      ),
    );
    const response = await fetch("/binary", { method: "POST", body: bytes });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const event = await captured(events);
    for (const body of [event.request.body, event.response.body]) {
      expect(body).toMatchObject({ status: "truncated", encoding: "base64" });
      expect(
        new TextEncoder().encode(JSON.stringify(body)).length,
      ).toBeLessThanOrEqual(4096);
      expect(atob(body.text!).charCodeAt(0)).toBe(255);
      expect(body.text!.length % 4).toBe(0);
    }
  });

  it("preserves NUL-containing text as base64 instead of sending invalid JSON strings", async () => {
    const text = "before\0after";
    const events = setup(vi.fn<typeof fetch>(async () => new Response(text)));
    const response = await fetch("/nul", { method: "POST", body: text });
    expect(await response.text()).toBe(text);
    const event = await captured(events);
    for (const body of [event.request.body, event.response.body]) {
      expect(body).toMatchObject({ status: "complete", encoding: "base64" });
      expect(atob(body.text!)).toBe(text);
    }
  });

  it("times out observation of SSE without cancelling the caller's stream", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const events = setup(
      vi.fn<typeof fetch>(
        async () =>
          new Response(stream, {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
    const response = await fetch("/events");
    const reader = response.body!.getReader();
    controller.enqueue(new TextEncoder().encode("data: first\n\n"));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "data: first\n\n",
    );
    await microtasks();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events[0]!.value.completedAt).toBe(100_000);
    expect(events[0]!.value.response.body).toMatchObject({
      status: "timeout",
      reason: "body-read-timeout",
      text: "data: first\n\n",
    });
    controller.enqueue(new TextEncoder().encode("data: next\n\n"));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "data: next\n\n",
    );
    controller.close();
    expect((await reader.read()).done).toBe(true);
  });

  it("keeps metadata when a cloned response stream fails after a partial body", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const events = setup(vi.fn<typeof fetch>(async () => new Response(stream)));
    const response = await fetch("/interrupted");
    const reader = response.body!.getReader();
    controller.enqueue(new TextEncoder().encode("partial"));
    await reader.read();
    await microtasks();
    const error = new Error("broken body");
    controller.error(error);
    await expect(reader.read()).rejects.toBe(error);
    const event = await captured(events);
    expect(event).toMatchObject({
      status: 200,
      outcome: "ok",
      response: {
        body: {
          status: "interrupted",
          reason: "body-read-failed",
          text: "partial",
        },
      },
    });
  });

  it("does not read or replace a caller-owned init.body stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("upload"));
        controller.close();
      },
    });
    const native = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.body).toBe(stream);
      expect(stream.locked).toBe(false);
      expect(await new Response(init?.body).text()).toBe("upload");
      return new Response("ok");
    });
    const events = setup(native);
    await fetch("/stream-upload", { method: "POST", body: stream });
    const event = await captured(events);
    expect(event.request.body).toEqual({
      status: "unavailable",
      reason: "caller-owned-stream",
    });
  });

  it("reports clone failures without dropping headers or metadata", async () => {
    const response = new Response("already consumed", {
      headers: { "X-Visible": "value" },
    });
    await response.text();
    const events = setup(vi.fn<typeof fetch>(async () => response));
    expect(await fetch("/used")).toBe(response);
    const event = await captured(events);
    expect(event.response).toMatchObject({
      headers: { "x-visible": "value" },
      body: { status: "unavailable", reason: "response-clone-failed" },
    });
  });

  it("does not leak a late completion across uninstall/reinstall and keeps third-party wrappers", async () => {
    const late = deferred<Response>();
    const native = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(late.promise)
      .mockResolvedValue(new Response("current"));
    const oldEvents = setup(native);
    const oldPromise = fetch("/old");
    const ours = globalThis.fetch;
    const thirdParty = vi.fn<typeof fetch>((input, init) => ours(input, init));
    globalThis.fetch = thirdParty;
    uninstall?.();
    expect(globalThis.fetch).toBe(thirdParty);
    const newEvents = setup(thirdParty);
    late.resolve(new Response("late"));
    await oldPromise;
    await fetch("/new");
    await captured(newEvents);
    expect(oldEvents).toEqual([]);
    expect(newEvents.map((event) => event.value.route)).toEqual(["/new"]);
  });

  it("cancels only observation on stop while the app can still finish reading", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const events = setup(vi.fn<typeof fetch>(async () => new Response(stream)));
    const response = await fetch("/pending-body");
    uninstall?.();
    const text = response.text();
    controller.enqueue(new TextEncoder().encode("after stop"));
    controller.close();
    expect(await text).toBe("after stop");
    await microtasks();
    expect(events).toEqual([]);
  });
});

class FakeXhr extends EventTarget {
  status = 200;
  responseType: XMLHttpRequestResponseType = "text";
  responseText = "response body";
  response: unknown = null;
  responseXML: Document | null = null;
  responseURL = "https://api.example.com/result?query=full#fragment";
  headers: Record<string, string> = {};
  sentBody: unknown;
  open(_method: string, _url: string | URL) {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getAllResponseHeaders() {
    return "Content-Type: text/plain\r\nX-Full: response-token\r\n";
  }
  send(body?: unknown) {
    this.sentBody = body;
  }
  finish() {
    this.dispatchEvent(new Event("loadend"));
  }
}

describe("XMLHttpRequest capture", () => {
  it("records real XHR response text without changing the native caller", async () => {
    const events = setup(respondWith());
    const xhr = new XMLHttpRequest();
    const done = new Promise((resolve) =>
      xhr.addEventListener("loadend", resolve),
    );
    xhr.open("get", "data:text/plain,hello");
    xhr.send();
    await done;
    expect(xhr.responseText).toBe("hello");
    const event = await captured(events);
    expect(event).toMatchObject({
      transport: "xhr",
      method: "GET",
      status: 200,
      outcome: "ok",
      response: { body: { status: "complete", text: "hello" } },
    });
  });

  it("captures full request/response headers, body and URLs", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const events = setup(respondWith());
    const xhr = new FakeXhr();
    xhr.open("post", "/api/deals/42?secret=full#hash");
    xhr.setRequestHeader("Authorization", "Bearer full-value");
    xhr.setRequestHeader("X-Multi", "one");
    xhr.setRequestHeader("X-Multi", "two");
    xhr.send("request body");
    expect(xhr.sentBody).toBe("request body");
    xhr.finish();
    const event = await captured(events);
    expect(event).toMatchObject({
      url: `${PAGE_ORIGIN}/api/deals/42?secret=[redacted]#hash`,
      route: "/api/deals/42",
      request: {
        headers: { authorization: "[redacted]", "x-multi": "one, two" },
        body: { text: "request body" },
      },
      response: {
        url: xhr.responseURL,
        headers: { "x-full": "response-token" },
        body: { text: "response body" },
      },
    });
  });

  it.each(["json", "arraybuffer"] as const)(
    "captures browser-visible XHR %s responses",
    async (responseType) => {
      vi.stubGlobal("XMLHttpRequest", FakeXhr);
      const events = setup(respondWith());
      const xhr = new FakeXhr();
      xhr.responseType = responseType;
      // Declared text is decoded and redacted; only binary types stay base64.
      xhr.getAllResponseHeaders = () =>
        "Content-Type: application/octet-stream\r\n";
      xhr.response =
        responseType === "json"
          ? { complete: true }
          : new Uint8Array([0, 1, 255]).buffer;
      xhr.open("get", "/typed-response");
      xhr.send();
      xhr.finish();
      const event = await captured(events);
      if (responseType === "json")
        expect(event.response.body.text).toBe('{"complete":true}');
      else {
        expect(event.response.body.encoding).toBe("base64");
        expect(
          [...atob(event.response.body.text!)].map((char) =>
            char.charCodeAt(0),
          ),
        ).toEqual([0, 1, 255]);
      }
    },
  );

  it("forgets an in-flight request when the same XHR is opened again", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const events = setup(respondWith());
    const xhr = new FakeXhr();
    xhr.open("get", "/first");
    xhr.send();
    // A real open() ends /first without firing loadend.
    xhr.open("get", "/second");
    xhr.send();
    xhr.finish();
    await captured(events);
    await microtasks();

    expect(events.map((event) => event.value.route)).toEqual(["/second"]);
  });

  it("redacts credential response headers but keeps the others", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const events = setup(respondWith());
    const xhr = new FakeXhr();
    xhr.getAllResponseHeaders = () =>
      "Set-Cookie: session=abc\r\nX-Full: response-token\r\n";
    xhr.open("get", "/session");
    xhr.send();
    xhr.finish();

    expect(await captured(events)).toMatchObject({
      response: {
        headers: { "set-cookie": "[redacted]", "x-full": "response-token" },
      },
    });
  });

  it("records aborts, removes old listeners on reuse, and does not leak after stop", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const events = setup(respondWith());
    const xhr = new FakeXhr();
    xhr.open("get", "/first");
    xhr.send();
    xhr.finish();
    await captured(events);
    xhr.open("get", "/aborted");
    xhr.send();
    xhr.status = 0;
    xhr.dispatchEvent(new Event("abort"));
    xhr.finish();
    await captured(events, 2);
    expect(events[1]!.value).toMatchObject({
      outcome: "aborted",
      status: null,
      response: { body: { status: "interrupted" } },
    });
    xhr.open("get", "/late");
    xhr.send();
    uninstall?.();
    xhr.finish();
    await microtasks();
    expect(events).toHaveLength(2);
  });

  it("preserves synchronous XHR errors and records metadata", async () => {
    class ThrowingXhr extends FakeXhr {
      override send() {
        throw error;
      }
    }
    const error = new Error("invalid native state");
    vi.stubGlobal("XMLHttpRequest", ThrowingXhr);
    const events = setup(respondWith());
    const xhr = new ThrowingXhr();
    xhr.open("post", "/sync-failure");
    expect(() => xhr.send()).toThrow(error);
    expect((await captured(events)).outcome).toBe("error");
  });
});
