import React, { act } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";

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
});
