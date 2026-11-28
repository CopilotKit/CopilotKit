import { describe, expect, it, vi } from "vitest";
import {
  captureProbeThreads,
  cleanupProbeThreads,
} from "./probe-langgraph-threads.js";

describe("captureProbeThreads", () => {
  it("marks and records only thread IDs from CopilotKit run requests", async () => {
    let handler:
      | ((
          route: { continue(options?: { postData?: string }): Promise<void> },
          request: {
            url(): string;
            method(): string;
            postData(): string | null;
          },
        ) => Promise<void>)
      | undefined;
    const page = {
      async route(_pattern: RegExp, callback: typeof handler) {
        handler = callback;
      },
    };
    const ids = await captureProbeThreads(page, "d6-python-run-1");
    const continueRequest = vi.fn(
      async (_options?: { postData?: string }) => {},
    );
    const threadId = "a4b18d3d-766f-4bb2-8cce-f9085232fc37";
    const body = JSON.stringify({
      threadId,
      forwardedProps: {
        streamSubgraphs: true,
        threadMetadata: { owner: "demo" },
      },
    });

    await handler!(
      { continue: continueRequest },
      {
        url: () => "https://example.com/api/copilotkit",
        method: () => "POST",
        postData: () => body,
      },
    );

    expect([...ids]).toEqual([threadId]);
    expect(JSON.parse(continueRequest.mock.calls[0]![0]!.postData!)).toEqual({
      threadId,
      forwardedProps: {
        streamSubgraphs: true,
        threadMetadata: {
          owner: "demo",
          showcase_probe: true,
          showcase_probe_id: "d6-python-run-1",
        },
      },
    });
  });

  it("leaves unrelated requests untouched", async () => {
    let handler:
      | ((
          route: { continue(options?: { postData?: string }): Promise<void> },
          request: {
            url(): string;
            method(): string;
            postData(): string | null;
          },
        ) => Promise<void>)
      | undefined;
    const ids = await captureProbeThreads(
      {
        async route(_pattern: RegExp, callback: typeof handler) {
          handler = callback;
        },
      },
      "d6-python-run-1",
    );
    const continueRequest = vi.fn(
      async (_options?: { postData?: string }) => {},
    );
    await handler!(
      { continue: continueRequest },
      {
        url: () => "https://example.com/api/copilotkit/info",
        method: () => "POST",
        postData: () => "{}",
      },
    );
    expect(ids.size).toBe(0);
    expect(continueRequest).toHaveBeenCalledWith();
  });

  it("marks dedicated CopilotKit route runs", async () => {
    let handler:
      | ((
          route: { continue(options?: { postData?: string }): Promise<void> },
          request: {
            url(): string;
            method(): string;
            postData(): string | null;
          },
        ) => Promise<void>)
      | undefined;
    await captureProbeThreads(
      {
        async route(_pattern, callback) {
          handler = callback;
        },
      },
      "d6-python-run-1",
    );
    const continueRequest = vi.fn(
      async (_options?: { postData?: string }) => {},
    );
    await handler!(
      { continue: continueRequest },
      {
        url: () => "https://example.com/api/copilotkit-voice/agent/default/run",
        method: () => "POST",
        postData: () =>
          JSON.stringify({ threadId: "a4b18d3d-766f-4bb2-8cce-f9085232fc37" }),
      },
    );
    expect(continueRequest.mock.calls[0]![0]?.postData).toContain(
      "showcase_probe_id",
    );
  });

  it("marks the run body inside a single-route envelope", async () => {
    let handler:
      | ((
          route: { continue(options?: { postData?: string }): Promise<void> },
          request: {
            url(): string;
            method(): string;
            postData(): string | null;
          },
        ) => Promise<void>)
      | undefined;
    const ids = await captureProbeThreads(
      {
        async route(_pattern, callback) {
          handler = callback;
        },
      },
      "d6-python-run-1",
    );
    const continueRequest = vi.fn(
      async (_options?: { postData?: string }) => {},
    );
    const threadId = "a4b18d3d-766f-4bb2-8cce-f9085232fc37";
    await handler!(
      { continue: continueRequest },
      {
        url: () => "https://example.com/api/copilotkit",
        method: () => "POST",
        postData: () =>
          JSON.stringify({
            method: "agent/run",
            params: { agentId: "default" },
            body: { threadId, messages: [] },
          }),
      },
    );
    expect([...ids]).toEqual([threadId]);
    expect(
      JSON.parse(continueRequest.mock.calls[0]![0]!.postData!).body
        .forwardedProps.threadMetadata.showcase_probe_id,
    ).toBe("d6-python-run-1");
  });
});

describe("cleanupProbeThreads", () => {
  const threadId = "a4b18d3d-766f-4bb2-8cce-f9085232fc37";

  it("presents the probe cleanup token when the harness has one", async () => {
    vi.stubEnv("SHOWCASE_PROBE_TOKEN", "probe-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ deleted: 1, expired: 0 }));
    const warn = vi.fn();

    await cleanupProbeThreads(
      "https://showcase.example",
      "d6-python-run-1",
      new Set([threadId]),
      { warn },
    );

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://showcase.example/api/probe-threads");
    expect((options as RequestInit).headers).toEqual({
      "content-type": "application/json",
      "x-probe-token": "probe-token",
    });
    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("sends no token header when the harness has none configured", async () => {
    vi.stubEnv("SHOWCASE_PROBE_TOKEN", "");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ deleted: 1, expired: 0 }));
    const warn = vi.fn();

    await cleanupProbeThreads(
      "https://showcase.example",
      "d6-python-run-1",
      new Set([threadId]),
      { warn },
    );

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://showcase.example/api/probe-threads");
    expect((options as RequestInit).headers).toEqual({
      "content-type": "application/json",
    });
    vi.unstubAllEnvs();
  });

  it("warns once when the deployment rejects the cleanup", async () => {
    vi.stubEnv("SHOWCASE_PROBE_TOKEN", "probe-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 403 }));
    const warn = vi.fn();

    await cleanupProbeThreads(
      "https://showcase.example",
      "d6-python-run-1",
      new Set([threadId]),
      { warn },
    );

    expect(warn).toHaveBeenCalledWith("probe.e2e.langgraph-cleanup-failed", {
      status: 403,
    });
    vi.unstubAllEnvs();
  });
});
