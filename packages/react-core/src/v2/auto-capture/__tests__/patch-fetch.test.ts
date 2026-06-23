import { describe, expect, it, vi } from "vitest";
import type { AutoCaptureBridge } from "../bridge";
import { createPatchedFetch } from "../patch-fetch";
import type { RawExchange } from "../types";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const makeBridge = (): { bridge: AutoCaptureBridge; calls: RawExchange[] } => {
  const calls: RawExchange[] = [];
  const bridge: AutoCaptureBridge = {
    enabled: true,
    dispatch: (raw) => calls.push(raw),
  };
  return { bridge, calls };
};

describe("createPatchedFetch", () => {
  it("captures a JSON POST exchange and leaves the response readable by the app", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async () => jsonResponse({ ok: true }));
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    const response = await patched("https://app.test/api/x", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });

    // The app still gets the original, unconsumed body.
    await expect(response.json()).resolves.toEqual({ ok: true });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://app.test/api/x",
      requestBody: { a: 1 },
      status: 200,
      responseBody: { ok: true },
    });
    expect(typeof calls[0]!.durationMs).toBe("number");
  });

  it("delegates without capturing when the bridge is disabled", async () => {
    const { bridge, calls } = makeBridge();
    bridge.enabled = false;
    const original = vi.fn(async () => jsonResponse({ ok: true }));
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    await patched("https://app.test/api/x", { method: "POST" });

    expect(original).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("propagates network errors and records nothing", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    await expect(
      patched("https://app.test/api/x", { method: "POST" }),
    ).rejects.toThrow("network down");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(0);
  });

  it("reads the body from a Request input without consuming it", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async (input: RequestInfo | URL) => {
      // The original still sees a readable body.
      const req = input as Request;
      await req.clone().text();
      return jsonResponse({ ok: true });
    });
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    const request = new Request("https://app.test/api/y", {
      method: "PUT",
      body: JSON.stringify({ b: 2 }),
      headers: { "content-type": "application/json" },
    });
    await patched(request);

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: "https://app.test/api/y",
      requestBody: { b: 2 },
    });
  });

  it("accepts a URL object as the input", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async () => jsonResponse({ ok: true }));
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    await patched(new URL("https://app.test/api/z"), { method: "POST" });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe("https://app.test/api/z");
    expect(calls[0]!.method).toBe("POST");
  });

  it("captures a no-body request with requestBody=undefined", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async () => jsonResponse({ ok: true }));
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    await patched("https://app.test/api/delete-me", { method: "DELETE" });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.requestBody).toBeUndefined();
    expect(calls[0]!.method).toBe("DELETE");
  });

  it("decodes a FormData request body into a plain object", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async () => jsonResponse({ ok: true }));
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    const form = new FormData();
    form.append("title", "hello");
    form.append("file", new Blob(["x"]), "x.txt");
    await patched("https://app.test/api/upload", {
      method: "POST",
      body: form,
    });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.requestBody).toEqual({ title: "hello", file: "[file]" });
  });

  it("captures both members of a pair of concurrent fetches", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async () => jsonResponse({ ok: true }));
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    await Promise.all([
      patched("https://app.test/api/a", { method: "POST" }),
      patched("https://app.test/api/b", { method: "POST" }),
    ]);

    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const urls = calls.map((c) => c.url).sort();
    expect(urls).toEqual(["https://app.test/api/a", "https://app.test/api/b"]);
  });

  it("captures status from a non-2xx response without throwing", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(
      async () =>
        new Response("", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    );
    const patched = createPatchedFetch(
      original as unknown as typeof fetch,
      bridge,
    );

    const res = await patched("https://app.test/api/x", { method: "POST" });
    expect(res.status).toBe(500);

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.status).toBe(500);
  });
});
