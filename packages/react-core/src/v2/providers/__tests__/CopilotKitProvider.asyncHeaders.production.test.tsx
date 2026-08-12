import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";

describe("CopilotKitProvider async header production anchor", () => {
  it("holds the first request until the async header is settled", async () => {
    let release!: (value: Record<string, string>) => void;
    const source = () =>
      new Promise<Record<string, string>>((resolve) => (release = resolve));
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "1", agents: {} }), {
        status: 200,
      }),
    );

    render(
      <CopilotKitProvider runtimeUrl="https://runtime.example" headers={source}>
        <div>child</div>
      </CopilotKitProvider>,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    release({ Authorization: "Bearer resolved" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer resolved");
    console.log(
      `pre-settle requests: 0; first request Authorization: ${new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")}`,
    );
    fetchMock.mockRestore();
  });
});
