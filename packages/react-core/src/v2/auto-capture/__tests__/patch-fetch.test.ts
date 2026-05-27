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
    const patched = createPatchedFetch(original as unknown as typeof fetch, bridge);

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
    const patched = createPatchedFetch(original as unknown as typeof fetch, bridge);

    await patched("https://app.test/api/x", { method: "POST" });

    expect(original).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("propagates network errors and records nothing", async () => {
    const { bridge, calls } = makeBridge();
    const original = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const patched = createPatchedFetch(original as unknown as typeof fetch, bridge);

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
    const patched = createPatchedFetch(original as unknown as typeof fetch, bridge);

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
});
