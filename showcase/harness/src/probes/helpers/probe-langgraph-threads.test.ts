import { describe, expect, it, vi } from "vitest";
import { captureProbeThreads } from "./probe-langgraph-threads.js";

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
