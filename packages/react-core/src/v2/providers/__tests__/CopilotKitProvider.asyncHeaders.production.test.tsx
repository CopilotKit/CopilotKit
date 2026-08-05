import React, { act, useEffect, useRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { useConfigureSuggestions } from "../../hooks/use-configure-suggestions";
import { CopilotKit } from "../../../components/copilot-provider/copilotkit";
import { useConfigureChatSuggestions } from "../../../hooks/use-configure-chat-suggestions";
import { useCopilotChatInternal } from "../../../hooks/use-copilot-chat_internal";

function DynamicSuggestionsProbe() {
  useConfigureSuggestions({
    instructions: "Return one deterministic suggestion",
    providerAgentId: "default",
    consumerAgentId: "default",
    available: "always",
  });
  return null;
}

function LegacySuggestionsProbe() {
  useConfigureChatSuggestions({
    instructions: "Return one deterministic suggestion",
    available: "always",
  });
  return null;
}

function LegacyGenerateSuggestionsProbe() {
  useConfigureChatSuggestions({
    instructions: "Return one deterministic suggestion",
    available: "always",
  });
  const { generateSuggestions } = useCopilotChatInternal({
    suggestions: "manual",
  });
  const invokedRef = useRef(false);

  useEffect(() => {
    if (invokedRef.current) return;
    invokedRef.current = true;
    void generateSuggestions();
  }, [generateSuggestions]);

  return null;
}

describe("T1937 production-path reproduction", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0.0", agents: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("sends the async builder's Authorization on the first /info request", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const pendingHeaders = new Promise<Record<string, string>>((resolve) => {
      resolveHeaders = resolve;
    });

    render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example/rest"
        useSingleEndpoint={false}
        headers={(() => pendingHeaders) as never}
      >
        child
      </CopilotKitProvider>,
    );

    await act(async () => {
      resolveHeaders({ Authorization: "Bearer issue-1937" });
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const request = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(([url]) => String(url).includes("/info"));
    expect(request).toBeDefined();
    expect(new Headers(request?.[1]?.headers).get("Authorization")).toBe(
      "Bearer issue-1937",
    );
  });

  it("waits for async headers before reloading dynamic suggestions", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const pendingHeaders = new Promise<Record<string, string>>((resolve) => {
      resolveHeaders = resolve;
    });
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      const url = String(input);
      if (url.endsWith("/info")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "1.0.0",
              agents: {},
              suggestions: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response("", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example/rest"
        useSingleEndpoint={false}
        headers={() => pendingHeaders}
        agents__unsafe_dev_only={{
          default: new HttpAgent({ url: "https://agent.example" }),
        }}
      >
        <DynamicSuggestionsProbe />
      </CopilotKitProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const suggestionRequests = () =>
      requests.filter(([url]) => String(url).includes("agent.example"));
    expect(suggestionRequests()).toHaveLength(0);

    await act(async () => {
      resolveHeaders({ Authorization: "Bearer issue-1937" });
    });

    await waitFor(() => expect(suggestionRequests().length).toBeGreaterThan(0));
    expect(
      new Headers(suggestionRequests()[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer issue-1937");
  });

  it("applies async headers before CopilotChat starts its initial connect", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const pendingHeaders = new Promise<Record<string, string>>((resolve) => {
      resolveHeaders = resolve;
    });
    const agent = new HttpAgent({ url: "https://agent.example" });
    let headersAtConnect: Record<string, string> | undefined;
    const connectAgent = vi
      .spyOn(agent, "connectAgent")
      .mockImplementation(async () => {
        headersAtConnect = { ...agent.headers };
        return { result: undefined, newMessages: [] };
      });
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      if (String(input).includes("/info")) {
        return Promise.resolve(
          new Response(JSON.stringify({ version: "1.0.0", agents: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response("", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as unknown as typeof fetch;

    render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example/rest"
        useSingleEndpoint={false}
        headers={() => pendingHeaders}
        agents__unsafe_dev_only={{
          default: agent,
        }}
      >
        <CopilotChat agentId="default" threadId="thread-1937" />
      </CopilotKitProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(connectAgent).not.toHaveBeenCalled();

    await act(async () => {
      resolveHeaders({ Authorization: "Bearer issue-1937" });
    });

    await waitFor(() => expect(connectAgent).toHaveBeenCalledTimes(1));
    expect(headersAtConnect?.Authorization).toBe("Bearer issue-1937");
  });

  it("waits for async headers in the legacy onAgentsChanged suggestion reload", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const pendingHeaders = new Promise<Record<string, string>>((resolve) => {
      resolveHeaders = resolve;
    });
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      if (String(input).includes("/info")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "1.0.0",
              agents: {},
              suggestions: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response("", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as unknown as typeof fetch;

    render(
      <CopilotKit
        runtimeUrl="https://runtime.example/rest"
        useSingleEndpoint={false}
        headers={() => pendingHeaders}
        agent="default"
        agents__unsafe_dev_only={{
          default: new HttpAgent({ url: "https://agent.example" }),
        }}
      >
        <LegacySuggestionsProbe />
      </CopilotKit>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    const suggestionRequests = () =>
      requests.filter(([url]) => String(url).includes("agent.example"));
    expect(suggestionRequests()).toHaveLength(0);

    await act(async () => {
      resolveHeaders({ Authorization: "Bearer issue-1937" });
    });

    await waitFor(() => expect(suggestionRequests().length).toBeGreaterThan(0));
    expect(
      new Headers(suggestionRequests()[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer issue-1937");
  });

  it("waits for async headers in legacy generateSuggestions", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const pendingHeaders = new Promise<Record<string, string>>((resolve) => {
      resolveHeaders = resolve;
    });
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      if (String(input).includes("/info")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "1.0.0",
              agents: {},
              suggestions: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response("", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as unknown as typeof fetch;

    render(
      <CopilotKit
        runtimeUrl="https://runtime.example/rest"
        useSingleEndpoint={false}
        headers={() => pendingHeaders}
        agent="default"
        agents__unsafe_dev_only={{
          default: new HttpAgent({ url: "https://agent.example" }),
        }}
      >
        <LegacyGenerateSuggestionsProbe />
      </CopilotKit>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    const suggestionRequests = () =>
      requests.filter(([url]) => String(url).includes("agent.example"));
    expect(suggestionRequests()).toHaveLength(0);

    await act(async () => {
      resolveHeaders({ Authorization: "Bearer issue-1937" });
    });

    await waitFor(() => expect(suggestionRequests().length).toBeGreaterThan(0));
    expect(
      new Headers(suggestionRequests()[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer issue-1937");
  });
});
