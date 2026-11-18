import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useThreads } from "../use-threads";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function ThreadsConsumer() {
  useThreads({ agentId: "agent-1" });
  return null;
}

function threadListCalls() {
  return fetchMock.mock.calls.filter(
    ([url]) => typeof url === "string" && url.includes("/threads?"),
  );
}

describe("useThreads provider headers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents: {},
          threadEndpoints: {
            list: true,
            inspect: true,
            mutations: true,
            realtimeMetadata: true,
          },
        });
      }

      if (url.includes("/threads?")) {
        return jsonResponse({ threads: [] });
      }

      return jsonResponse({}, 404);
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes thread requests when provider headers change", async () => {
    const runtimeUrl = "https://runtime.example.com";

    const { rerender } = render(
      <CopilotKitProvider
        runtimeUrl={runtimeUrl}
        useSingleEndpoint={false}
        headers={{}}
      >
        <ThreadsConsumer />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(threadListCalls()).toHaveLength(1);
    });

    rerender(
      <CopilotKitProvider
        runtimeUrl={runtimeUrl}
        useSingleEndpoint={false}
        headers={{ "X-CSRF": "1" }}
      >
        <ThreadsConsumer />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      const calls = threadListCalls();
      expect(calls).toHaveLength(2);
      expect(calls[1]?.[1]).toMatchObject({
        headers: expect.objectContaining({ "X-CSRF": "1" }),
      });
    });
  });
});
