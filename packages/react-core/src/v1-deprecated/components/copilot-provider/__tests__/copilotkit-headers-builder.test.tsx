/**
 * #1937: v1's `<CopilotKit>` compatibility wrapper spreads `props.headers`
 * straight into the v2 `<CopilotKitProvider>` (see `copilotkit.tsx`), so the
 * send-time evaluation fix applies to v1 usage automatically — a run must
 * carry the builder's current token even when only a child re-rendered.
 *
 * v1's own `headers` prop type stays sync-only (`Record<string, string> |
 * (() => Record<string, string>)`, see `copilotkit-props.tsx`); async is a
 * v2-only capability, guarded below by a `@ts-expect-error`.
 */
import { act, render, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../../../v2";
import type { CopilotKitCoreReact } from "../../../../v2/lib/react-core";
import { CopilotKit } from "../copilotkit";

type Call = { url: string; auth: string | null };

function stubFetch(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const h = new Headers(init?.headers ?? (input as Request).headers);
    calls.push({ url, auth: h.get("authorization") });
    if (url.endsWith("/info")) {
      return new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: { default: { name: "default", description: "" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // A non-2xx here would read as a runtime health signal and trigger a
    // reachability re-probe (`handleRuntimeRequestOutcome` in
    // agent-registry.ts) — keep every run request a plain 200 so it can't
    // leak an extra `/info` call.
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

let token = "tok-1";

afterEach(() => {
  vi.unstubAllGlobals();
  token = "tok-1";
});

describe("v1 <CopilotKit> — headers builder evaluated at send time (#1937)", () => {
  it("a run carries the builder's current token when only a child re-rendered", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;
    let bumpChild!: () => void;

    function Child() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      const [, set] = useState(0);
      bumpChild = () => set((n) => n + 1);
      return null;
    }

    function App() {
      return (
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={() => ({ Authorization: `Bearer ${token}` })}
        >
          <Child />
        </CopilotKit>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());
    const callsBeforeRun = calls.length;

    // Token rotates (e.g. Clerk re-mint). Only the child re-renders.
    token = "tok-2";
    act(() => bumpChild());

    const agent = core.getAgent("default")!;
    await act(async () => {
      await core.runAgent({ agent }).catch(() => {});
    });

    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });
});

function _typeTest() {
  return (
    // @ts-expect-error v1 headers stay sync-only (#1937: async is v2-only)
    <CopilotKit runtimeUrl="/x" headers={async () => ({})} />
  );
}
