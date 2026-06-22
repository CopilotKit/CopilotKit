import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutoCaptureBridge } from "../bridge";
import { patchXHR, restoreXHR } from "../patch-xhr";
import type { RawExchange } from "../types";

/**
 * Minimal, network-free `XMLHttpRequest` stand-in. `open`/`send` live on the
 * prototype (so `patchXHR` captures them as the originals), and the test drives
 * the lifecycle manually via `setResponse` + `fireLoadEnd`.
 */
class FakeXHR {
  status = 0;
  responseType: XMLHttpRequestResponseType = "";
  responseText = "";
  private headers: Record<string, string> = {};
  private listeners: Record<
    string,
    Array<(event: { currentTarget: unknown }) => void>
  > = {};

  open(_method: string, _url: string): void {}
  send(_body?: unknown): void {}

  addEventListener(
    type: string,
    cb: (event: { currentTarget: unknown }) => void,
  ): void {
    (this.listeners[type] ??= []).push(cb);
  }

  getResponseHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null;
  }

  setResponse(
    status: number,
    body: string,
    contentType = "application/json",
  ): void {
    this.status = status;
    this.responseText = body;
    this.headers["content-type"] = contentType;
  }

  fireLoadEnd(): void {
    for (const cb of this.listeners["loadend"] ?? []) {
      cb({ currentTarget: this });
    }
  }
}

const makeBridge = (): { bridge: AutoCaptureBridge; calls: RawExchange[] } => {
  const calls: RawExchange[] = [];
  const bridge: AutoCaptureBridge = {
    enabled: true,
    dispatch: (raw) => calls.push(raw),
  };
  return { bridge, calls };
};

let realXHR: typeof XMLHttpRequest;

beforeEach(() => {
  realXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  restoreXHR();
  globalThis.XMLHttpRequest = realXHR;
});

describe("patchXHR", () => {
  it("captures a POST exchange on loadend", () => {
    const { bridge, calls } = makeBridge();
    patchXHR(bridge);

    const xhr = new globalThis.XMLHttpRequest() as unknown as FakeXHR;
    xhr.open("POST", "https://app.test/api/orders");
    xhr.send(JSON.stringify({ a: 1 }));
    xhr.setResponse(200, JSON.stringify({ ok: true }));
    xhr.fireLoadEnd();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://app.test/api/orders",
      requestBody: { a: 1 },
      status: 200,
      responseBody: { ok: true },
    });
  });

  it("does not capture when the bridge is disabled", () => {
    const { bridge, calls } = makeBridge();
    bridge.enabled = false;
    patchXHR(bridge);

    const xhr = new globalThis.XMLHttpRequest() as unknown as FakeXHR;
    xhr.open("POST", "https://app.test/api/orders");
    xhr.send("{}");
    xhr.setResponse(200, "{}");
    xhr.fireLoadEnd();

    expect(calls).toHaveLength(0);
  });

  it("restores the original prototype methods", () => {
    const originalOpen = FakeXHR.prototype.open;
    const originalSend = FakeXHR.prototype.send;
    const { bridge } = makeBridge();

    patchXHR(bridge);
    expect(FakeXHR.prototype.open).not.toBe(originalOpen);

    restoreXHR();
    expect(FakeXHR.prototype.open).toBe(originalOpen);
    expect(FakeXHR.prototype.send).toBe(originalSend);
  });

  it("returns undefined responseBody for binary responseTypes (e.g. blob)", () => {
    const { bridge, calls } = makeBridge();
    patchXHR(bridge);

    const xhr = new globalThis.XMLHttpRequest() as unknown as FakeXHR;
    xhr.open("POST", "https://app.test/api/upload");
    xhr.send("{}");
    xhr.responseType = "blob";
    xhr.status = 200;
    xhr.fireLoadEnd();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.responseBody).toBeUndefined();
  });

  it("still dispatches when status=0 (CORS / abort) — leaves the consumer to decide", () => {
    const { bridge, calls } = makeBridge();
    patchXHR(bridge);

    const xhr = new globalThis.XMLHttpRequest() as unknown as FakeXHR;
    xhr.open("POST", "https://app.test/api/x");
    xhr.send("{}");
    xhr.fireLoadEnd();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(0);
  });

  it("accepts a URL object passed to open()", () => {
    const { bridge, calls } = makeBridge();
    patchXHR(bridge);

    const xhr = new globalThis.XMLHttpRequest() as unknown as FakeXHR;
    xhr.open(
      "POST",
      new URL("https://app.test/api/url-obj") as unknown as string,
    );
    xhr.send("{}");
    xhr.setResponse(200, "{}");
    xhr.fireLoadEnd();

    expect(calls[0]!.url).toBe("https://app.test/api/url-obj");
  });
});
