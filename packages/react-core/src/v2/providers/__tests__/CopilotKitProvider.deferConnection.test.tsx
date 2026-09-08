/**
 * Regression coverage for #5801: a normal provider mount issues exactly one
 * runtime `/info` request (real core + mocked fetch), and `connect()` stays
 * idempotent under StrictMode's double-invoked mount effect.
 *
 * NOTE on scope: the actual bug (dozens of `/info`) only manifests when React
 * *discards* in-progress renders and constructs multiple orphaned cores — which
 * Testing Library cannot reproduce (a committed single mount yields exactly one
 * `/info` whether the ctor or an effect fires it, and the ctor's fetch is
 * several microtasks deep so ordering doesn't distinguish it either). The
 * mechanism that fixes the multi-instance case is proven in `packages/core` by
 * `core-defer-runtime-connection.test.ts` ("orphaned cores that never connect()
 * fire zero /info"); the deferral WIRING is asserted in
 * `CopilotKitProvider.deferWiring.test.tsx`. These two tests guard against the
 * connection regressing to zero or duplicating on a normal mount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { CopilotKitProvider } from "../CopilotKitProvider";

const RUNTIME_URL = "https://runtime.example/rest";
const infoResponse = { version: "1.0.0", agents: {} };

describe("CopilotKitProvider — runtime connection (real core, #5801)", () => {
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

  it("fetches /info exactly once under StrictMode (double-invoked mount effect stays idempotent)", async () => {
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
