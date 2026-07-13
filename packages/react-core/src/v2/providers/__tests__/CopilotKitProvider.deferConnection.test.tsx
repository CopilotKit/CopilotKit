/**
 * Regression test for #5801: the provider must issue exactly one runtime
 * `/info` request per mount, driven from a commit-phase effect rather than the
 * core constructor.
 *
 * Uses the REAL `CopilotKitCoreReact` with a mocked `fetch` so we count actual
 * `/info` requests. Under React StrictMode the mount effect is double-invoked
 * (mount → cleanup → remount); `connect()` is idempotent, so the count must
 * stay at one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { CopilotKitProvider } from "../CopilotKitProvider";

const RUNTIME_URL = "https://runtime.example/rest";
const infoResponse = { version: "1.0.0", agents: {} };

describe("CopilotKitProvider — deferred runtime connection (#5801)", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(infoResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  const infoCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).includes("/info"));

  it("fetches /info exactly once on mount", async () => {
    render(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
        <div>child</div>
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(infoCalls().length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(infoCalls().length).toBe(1);
  });

  it("fetches /info exactly once under StrictMode (double-invoked mount effect)", async () => {
    render(
      <React.StrictMode>
        <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
          <div>child</div>
        </CopilotKitProvider>
      </React.StrictMode>,
    );

    await waitFor(() => expect(infoCalls().length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(infoCalls().length).toBe(1);
  });
});
