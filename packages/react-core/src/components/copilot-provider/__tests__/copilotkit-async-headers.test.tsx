import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopilotKit } from "../copilotkit";

describe("v1 async headers", () => {
  it("hands the settled concrete record to the v1 subtree", async () => {
    let release!: (value: Record<string, string>) => void;
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "1", agents: {} }), {
        status: 200,
      }),
    );
    const view = render(
      <CopilotKit
        runtimeUrl="https://runtime.example"
        agents__unsafe_dev_only={{
          default: {
            clone: vi.fn(),
            run: vi.fn(),
            subscribe: vi.fn(() => ({ unsubscribe: () => {} })),
          } as any,
        }}
        headers={() => new Promise((resolve) => (release = resolve))}
      >
        <div>v1-child</div>
      </CopilotKit>,
    );
    expect(view.queryByText("v1-child")).toBeNull();
    release({ Authorization: "Bearer settled" });
    await waitFor(() => expect(view.queryByText("v1-child")).not.toBeNull());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const headers = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).headers,
    );
    expect(headers.get("Authorization")).toBe("Bearer settled");
    fetchMock.mockRestore();
  });

  it("forwards an initial header failure through the v1 error shape", async () => {
    const onError = vi.fn();
    const original = new Error("token unavailable");
    render(
      <CopilotKit
        runtimeUrl="https://runtime.example"
        headers={() => Promise.reject(original)}
        onError={onError}
      >
        <div>v1-child</div>
      </CopilotKit>,
    );
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      type: "error",
      error: original,
      context: {
        source: "headers",
        request: { operation: "header_resolution_failed" },
      },
    });
  });
});
