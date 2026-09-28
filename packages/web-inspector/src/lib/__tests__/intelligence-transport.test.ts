import { expect, test, vi } from "vitest";
import { fetchInspectorIntelligence } from "../intelligence-transport.js";

test("uses the host's authenticated fetch and keeps credentials out of the read envelope", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ version: 1 }), { status: 200 }),
    );
  const controller = new AbortController();
  const result = await fetchInspectorIntelligence(
    {
      runtimeUrl: "https://app.example/api/copilot/",
      runtimeTransport: "rest",
      fetch,
      headers: { Authorization: "Bearer fixture" },
      credentials: "include",
    },
    { method: "GET", path: "/context" },
    controller.signal,
  );

  expect(result).toEqual({ status: 200, body: { version: 1 } });
  expect(fetch).toHaveBeenCalledWith(
    "https://app.example/api/copilot/inspector-intelligence",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method: "GET", path: "/context" }),
    }),
  );
});

test("wraps reads for the negotiated single endpoint", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ data: [] })));
  const request = { method: "GET", path: "/api/v1/runs" } as const;

  await fetchInspectorIntelligence(
    {
      runtimeUrl: "https://app.example/api/copilot",
      runtimeTransport: "single",
      fetch,
    },
    request,
    new AbortController().signal,
  );

  expect(fetch).toHaveBeenCalledWith(
    "https://app.example/api/copilot",
    expect.objectContaining({
      body: JSON.stringify({ method: "inspector/intelligence", body: request }),
    }),
  );
});

test("returns an access denial without leaking the upstream error body", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response("private upstream error", { status: 403 }));

  const result = await fetchInspectorIntelligence(
    {
      runtimeUrl: "https://app.example/api/copilot",
      runtimeTransport: "auto",
      fetch,
    },
    { method: "GET", path: "/context" },
    new AbortController().signal,
  );

  expect(result).toEqual({ status: 403, body: null });
});
