import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotKitCoreErrorCode } from "@copilotkit/core";

describe("CopilotKitProvider async headers", () => {
  it("waits for the first concrete record before requesting /info", async () => {
    let release!: (value: Record<string, string>) => void;
    const source = () =>
      new Promise<Record<string, string>>((resolve) => (release = resolve));
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "1", agents: {} }), {
        status: 200,
      }),
    );
    const { queryByText } = render(
      <CopilotKitProvider runtimeUrl="https://runtime.example" headers={source}>
        <div>child</div>
      </CopilotKitProvider>,
    );
    expect(queryByText("child")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    release({ Authorization: "Bearer resolved" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer resolved" }),
    );
    fetchMock.mockRestore();
  });

  it("reports the original initial resolution error", async () => {
    const original = new Error("token unavailable");
    const onError = vi.fn();
    const view = render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example"
        headers={() => Promise.reject(original)}
        onError={onError}
      >
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(view.queryByText("child")).not.toBeNull();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: CopilotKitCoreErrorCode.HEADER_RESOLUTION_FAILED,
      error: original,
      context: { source: "headers", runtimeUrl: "https://runtime.example" },
    });
  });

  it("reconnects after an initial failure is replaced by a synchronous record", async () => {
    const original = new Error("token unavailable");
    const onError = vi.fn();
    let source:
      | Record<string, string>
      | (() => Promise<Record<string, string>>) = () =>
      Promise.reject(original);
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "1", agents: {} }), {
        status: 200,
      }),
    );
    const view = render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example"
        headers={source}
        onError={onError}
      >
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();

    source = { Authorization: "Bearer recovered" };
    view.rerender(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example"
        headers={source}
        onError={onError}
      >
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer recovered");
    view.unmount();
    fetchMock.mockRestore();
  });

  it("keeps core nullish-value normalization for static records", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "1", agents: {} }), {
        status: 200,
      }),
    );
    render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example"
        headers={
          { Authorization: undefined } as unknown as Record<string, string>
        }
      >
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.has("Authorization")).toBe(false);
    fetchMock.mockRestore();
  });
});
