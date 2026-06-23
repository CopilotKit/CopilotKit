import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopilotKitProvider,
  useCopilotKit,
} from "../../providers/CopilotKitProvider";
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

function CoreCapture({
  onCore,
}: {
  onCore: (core: ReturnType<typeof useCopilotKit>["copilotkit"]) => void;
}) {
  const { copilotkit } = useCopilotKit();
  React.useEffect(() => {
    onCore(copilotkit);
  }, [copilotkit, onCore]);
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

  it("refreshes thread requests when provider credentials change", async () => {
    const runtimeUrl = "https://runtime.example.com";

    const { rerender } = render(
      <CopilotKitProvider runtimeUrl={runtimeUrl} useSingleEndpoint={false}>
        <ThreadsConsumer />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(threadListCalls()).toHaveLength(1);
      expect(threadListCalls()[0]?.[1]).not.toMatchObject({
        credentials: "include",
      });
    });

    rerender(
      <CopilotKitProvider
        runtimeUrl={runtimeUrl}
        useSingleEndpoint={false}
        credentials="include"
      >
        <ThreadsConsumer />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      const calls = threadListCalls();
      expect(calls).toHaveLength(2);
      expect(calls[1]?.[1]).toMatchObject({
        credentials: "include",
      });
    });
  });

  it("refreshes thread requests when core credentials change directly", async () => {
    const runtimeUrl = "https://runtime.example.com";
    let core: ReturnType<typeof useCopilotKit>["copilotkit"] | null = null;

    render(
      <CopilotKitProvider runtimeUrl={runtimeUrl} useSingleEndpoint={false}>
        <CoreCapture
          onCore={(nextCore) => {
            core = nextCore;
          }}
        />
        <ThreadsConsumer />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(threadListCalls()).toHaveLength(1);
    });

    act(() => {
      core?.setCredentials("include");
    });

    await waitFor(() => {
      const calls = threadListCalls();
      expect(calls).toHaveLength(2);
      expect(calls[1]?.[1]).toMatchObject({
        credentials: "include",
      });
    });
  });
});
